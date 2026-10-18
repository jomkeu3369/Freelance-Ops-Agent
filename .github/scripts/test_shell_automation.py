"""SSH·이미지 저장소·HTTP를 대체해 배포와 검사 서버의 경계를 확인한다."""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


class ShellAutomationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory(prefix="workflow-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.repository = Path(__file__).resolve().parents[2]
        self.action = self.repository / ".github/actions/deploy-service"
        self.bash = "C:/Program Files/Git/bin/bash.exe" if os.name == "nt" else shutil.which("bash")
        self.env = os.environ.copy()
        self.env.update(
            {
                "AUTOMATION_TEST_BIN": self.bin.as_posix(),
                "TEST_BASH": self.bash,
                "LOG_PATH": (self.root / "commands.log").as_posix(),
                "TOKEN_CAPTURE": (self.root / "token.txt").as_posix(),
                "SSH_DIRECTORY": (self.root / "ssh keys").as_posix(),
                "DEPLOY_SERVICE": "agent",
                "IMAGE_TAG": "agent-release-1",
                "DEPLOY_HOST": "ci.invalid",
                "DEPLOY_USER": "ci",
                "GHCR_USER": "ci-user",
                "GHCR_TOKEN": "ci-token-from-stdin",
                "SSH_PRIVATE_KEY": "ci-private-key-fixture",
                "SSH_HOST_KEY": "ci-host-key-fixture",
                "POSTGRES_IDS": "postgres-1\n",
            }
        )
        self.mock(
            "ssh",
            """
printf 'ssh <%s> <%s>\n' "$1" "$2" >> "$LOG_PATH"
if [ "${MOCK_SSH_EXIT:-0}" -ne 0 ]; then exit "$MOCK_SSH_EXIT"; fi
case "$2" in
    *--password-stdin*) cat > "$TOKEN_CAPTURE" ;;
    'bash -se') "$TEST_BASH" -se ;;
esac
"""
        )
        for command in ("tar", "scp"):
            self.mock(
                command,
                'printf "%s" "'
                + command
                + '" >> "$LOG_PATH"\nprintf " <%s>" "$@" >> "$LOG_PATH"\nprintf "\\n" >> "$LOG_PATH"\n'
            )
        self.mock(
            "docker",
            """
printf 'docker' >> "$LOG_PATH"
printf ' <%s>' "$@" >> "$LOG_PATH"
printf '\n' >> "$LOG_PATH"
if [ "$1" = ps ]; then printf '%s' "$POSTGRES_IDS"; fi
"""
        )
        self.mock(
            "npm",
            'if [ "${MOCK_NPM_EXIT:-0}" -ne 0 ]; then exit "$MOCK_NPM_EXIT"; fi\nexec /usr/bin/sleep 60\n'
        )
        self.mock("curl", 'exit "${MOCK_CURL_EXIT:-0}"\n')
        self.mock("sleep", "exit 0\n")
        if os.name == "nt":
            # NTFS에서는 권한 인자를 검사하고, Linux CI에서는 실제 모드를 확인한다.
            self.mock("install", 'test "$1" = -m\ntest "$2" = 700\ntest "$3" = -d\nmkdir -p "$4"\n')
            self.mock("chmod", 'test "$1" = 600\n')

    def mock(self, name: str, body: str) -> None:
        path = self.bin / name
        path.write_text("#!/usr/bin/env bash\nset -eu\n" + body, encoding="utf-8", newline="\n")
        path.chmod(0o755)

    def run_script(self, path: Path, *arguments: str) -> subprocess.CompletedProcess:
        setup = """
if command -v cygpath >/dev/null; then
    AUTOMATION_TEST_BIN=$(cygpath -u "$AUTOMATION_TEST_BIN")
    export TEST_BASH=$(cygpath -u "$TEST_BASH")
    export LOG_PATH=$(cygpath -u "$LOG_PATH")
    export TOKEN_CAPTURE=$(cygpath -u "$TOKEN_CAPTURE")
    export SSH_DIRECTORY=$(cygpath -u "$SSH_DIRECTORY")
fi
export PATH="$AUTOMATION_TEST_BIN:$PATH"
test "$(command -v ssh)" = "$AUTOMATION_TEST_BIN/ssh" || exit 99
exec "$TEST_BASH" "$@"
"""
        return subprocess.run(
            [self.bash, "-c", setup, "automation-test", path.as_posix(), *arguments],
            cwd=self.root,
            env=self.env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60
        )

    def log(self) -> str:
        path = self.root / "commands.log"
        return path.read_text(encoding="utf-8") if path.exists() else ""

    def test_invalid_services_and_mutable_or_unsafe_tags_stop_before_network(self):
        for service, tag in (
            ("other", "release-1"),
            ("agent", "latest"),
            ("agent", "main"),
            ("agent", "dev"),
            ("agent", "../escape"),
            ("backend", "tag'; echo unsafe"),
        ):
            with self.subTest(service=service, tag=tag):
                self.env.update(DEPLOY_SERVICE=service, IMAGE_TAG=tag)
                self.assertNotEqual(
                    0, self.run_script(self.action / "release.sh", "upload").returncode
                )
                self.assertEqual("", self.log())

    def test_both_services_upload_the_same_required_bundle(self):
        for service in ("agent", "backend"):
            with self.subTest(service=service):
                self.env.update(DEPLOY_SERVICE=service, IMAGE_TAG=f"{service}-release-1")
                result = self.run_script(self.action / "release.sh", "upload")
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertIn(
                    f"/opt/freelance-ops/releases/{service}/{service}-release-1", self.log()
                )
                self.assertIn(
                    "<docker-compose.yaml> <docker-compose.production.yaml> <infra/caddy> <infra/scripts>",
                    self.log()
                )

    def test_registry_token_uses_stdin_and_only_target_service_is_deployed(self):
        result = self.run_script(self.action / "release.sh", "deploy")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(self.env["GHCR_TOKEN"], (self.root / "token.txt").read_text())
        self.assertNotIn(self.env["GHCR_TOKEN"], self.log() + result.stdout + result.stderr)
        self.assertIn("deploy-service.sh agent 'agent-release-1'", self.log())
        self.assertNotIn("deploy-service.sh backend", self.log())

    def test_failed_registry_login_stops_service_deployment(self):
        self.env["MOCK_SSH_EXIT"] = "23"
        self.assertEqual(23, self.run_script(self.action / "release.sh", "deploy").returncode)
        self.assertNotIn("deploy-service.sh", self.log())

    def test_ssh_trust_preserves_key_content_and_permissions(self):
        result = self.run_script(self.action / "ssh-trust.sh")
        self.assertEqual(0, result.returncode, result.stderr)
        directory = self.root / "ssh keys"
        self.assertEqual(self.env["SSH_PRIVATE_KEY"] + "\n", (directory / "id_ed25519").read_text())
        self.assertEqual(self.env["SSH_HOST_KEY"] + "\n", (directory / "known_hosts").read_text())
        if os.name != "nt":
            self.assertEqual(0o700, stat.S_IMODE(directory.stat().st_mode))
            self.assertEqual(0o600, stat.S_IMODE((directory / "id_ed25519").stat().st_mode))

    def test_postgres_extension_requires_exactly_one_infra_container(self):
        result = self.run_script(self.action / "prepare-postgres.sh")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("com.docker.compose.project=freelance-ops-v2-infra", self.log())
        self.assertIn("CREATE EXTENSION IF NOT EXISTS btree_gist", self.log())
        for identifiers in ("", "one\ntwo\n"):
            self.env["POSTGRES_IDS"] = identifiers
            (self.root / "commands.log").unlink()
            self.assertNotEqual(0, self.run_script(self.action / "prepare-postgres.sh").returncode)
            self.assertNotIn("<exec>", self.log())

    def test_frontend_wrapper_preserves_check_exit_status_and_output_directory(self):
        wrapper = self.repository / ".github/scripts/with-frontend-server.sh"
        result = self.run_script(wrapper, "evidence with spaces", self.bash, "-c", "exit 17")
        self.assertEqual(17, result.returncode, result.stderr)
        self.assertTrue((self.root / "evidence with spaces/server.log").exists())

    def test_frontend_wrapper_rejects_server_start_failure(self):
        self.env.update(MOCK_CURL_EXIT="1", MOCK_NPM_EXIT="3")
        wrapper = self.repository / ".github/scripts/with-frontend-server.sh"
        result = self.run_script(wrapper, "evidence", self.bash, "-c", "touch should-not-run")
        self.assertNotEqual(0, result.returncode)
        self.assertFalse((self.root / "should-not-run").exists())


if __name__ == "__main__":
    unittest.main()
