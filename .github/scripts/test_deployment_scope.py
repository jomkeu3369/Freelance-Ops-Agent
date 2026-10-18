"""서비스별 배포 범위와 첫 커밋·삭제·이동 처리를 검증한다."""

import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from deployment_scope import DeploymentScope, changed_paths, classify_paths


class DeploymentScopeTest(unittest.TestCase):
    def test_path_categories_preserve_service_boundaries(self):
        scenarios = {
            "agent/src/main.py": (True, False, False),
            "backend/build.gradle.kts": (False, True, False),
            "contracts/openapi/agent.yaml": (True, True, True),
            "infra/scripts/lib/deploy-common.sh": (True, True, True),
            "infra/caddy/Caddyfile": (False, True, True),
            "infra/postgres/init/001-init.sh": (False, False, True),
            "docker-compose-infra.yaml": (False, False, True),
            "docker-compose.production.yaml": (True, True, True),
            ".github/workflows/agent-cd.yml": (True, False, False),
            ".github/workflows/backend-ci.yml": (False, True, False),
            ".github/workflows/contracts-compose-ci.yml": (False, False, True),
            ".github/actions/deploy-service/release.sh": (True, True, True),
            ".github/scripts/deployment_scope.py": (True, True, True),
            ".github/scripts/verify_database_test_reports.py": (True, True, False),
            ".github/workflows/production-auto-cd.yml": (True, True, True),
            ".github/scripts/with-frontend-server.sh": (False, False, False),
            ".github/workflows/actions-ci.yml": (False, False, False),
            "frontend/app/page.tsx": (False, False, False),
            "docs/README.md": (False, False, False),
        }
        for path, expected in scenarios.items():
            with self.subTest(path=path):
                self.assertEqual(DeploymentScope(*expected), classify_paths([path]))

    def test_mixed_changes_accumulate_checks(self):
        self.assertEqual(
            DeploymentScope(True, True, True),
            classify_paths(["agent/a.py", "infra/caddy/Caddyfile"])
        )
        self.assertEqual(DeploymentScope(), classify_paths([]))

    def test_first_commit_deletions_and_moves_are_included(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)

            def git(*args):
                return (
                    subprocess.check_output(
                        [
                            "git",
                            "-c",
                            "core.hooksPath=/dev/null",
                            "-c",
                            "commit.gpgsign=false",
                            *args,
                        ],
                        cwd=root
                    )
                    .decode()
                    .strip()
                )

            git("init", "-q")
            git("config", "user.name", "CI")
            git("config", "user.email", "ci@example.invalid")
            (root / "agent").mkdir()
            (root / "agent/task.py").write_text("print('task')\n", encoding="utf-8")
            git("add", ".")
            git("commit", "-qm", "initial")
            first = git("rev-parse", "HEAD")
            self.assertEqual(["agent/task.py"], changed_paths("0" * 40, first, repository=root))
            (root / "backend").mkdir()
            (root / "agent/task.py").rename(root / "backend/task.py")
            git("add", "-A")
            git("commit", "-qm", "move")
            moved = git("rev-parse", "HEAD")
            self.assertEqual(
                {"agent/task.py", "backend/task.py"},
                set(changed_paths(first, moved, repository=root))
            )
            self.assertEqual(
                DeploymentScope(True, True, False),
                classify_paths(changed_paths(first, moved, repository=root))
            )
            (root / "backend/task.py").unlink()
            git("add", "-A")
            git("commit", "-qm", "delete")
            self.assertEqual(["backend/task.py"], changed_paths(moved, "HEAD", repository=root))


if __name__ == "__main__":
    unittest.main()
