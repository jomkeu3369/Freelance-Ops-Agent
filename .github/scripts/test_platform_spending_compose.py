"""Compose가 플랫폼 비용 집행의 기본 차단과 명시적 활성화를 전달하는지 확인한다."""

import json
import os
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


REPOSITORY = Path(__file__).resolve().parents[2]
# contracts-compose-ci.yml의 공개 검증용 값만 사용한다.
PRODUCTION_ENV = {
    "APP_DOMAIN": "example.com",
    "BACKEND_IMAGE": "example/backend",
    "AGENT_IMAGE": "example/agent",
    "BACKEND_IMAGE_TAG": "backend-ci",
    "AGENT_IMAGE_TAG": "agent-ci",
    "APP_DB_PASSWORD": "ci-app-password",
    "AGENT_DB_PASSWORD": "ci-agent-password",
    "APP_AUTH_JWT_SECRET": "ci-only-auth-secret-with-at-least-32-bytes",
    "AGENT_DELEGATION_TOKEN_PRIVATE_KEY": "ci-private-key-placeholder",
    "AGENT_DELEGATION_TOKEN_PUBLIC_KEY": "ci-public-key-placeholder",
    "AGENT_ROUTE_EVALUATOR_SYSTEM_PROMPT": "ci-private-prompt-placeholder",
    "AGENT_ROUTE_EVALUATOR_PROMPT_VERSION": "ci-v1",
    "AGENT_ROUTE_EVALUATOR_PROMPT_SHA256": "a" * 64,
}


class PlatformSpendingComposeTest(unittest.TestCase):
    def assert_spending_flag(self, *, production: bool, enabled: bool, input_quota: int | None = None):
        # CLI 실행과 플러그인 탐색 경로만 상속하고 실제 Compose 치환 값은 배제한다.
        environment = {
            name: os.environ[name]
            for name in (
                "PATH", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "PATHEXT",
                "ProgramFiles", "ProgramData", "ProgramFiles(x86)", "APPDATA", "LOCALAPPDATA",
            )
            if name in os.environ
        }
        environment.update(PRODUCTION_ENV)
        if enabled:
            environment["PLATFORM_AI_SPEND_ENABLED"] = "true"
        if input_quota is not None:
            environment["AGENT_QUOTA_MAX_INPUT_TOKENS"] = str(input_quota)
        with TemporaryDirectory(prefix="compose-spending-test-") as directory:
            empty_env = Path(directory) / "empty.env"
            empty_env.write_text("", encoding="utf-8")
            command = ["docker", "compose", "--env-file", str(empty_env), "-f", "docker-compose.yaml"]
            if production:
                command.extend(["-f", "docker-compose.production.yaml"])
            # config는 daemon 없이 설정만 해석한다. 컨테이너나 이미지는 실행하지 않는다.
            command.extend(["config", "--format", "json"])
            result = subprocess.run(
                command, cwd=REPOSITORY, env=environment, capture_output=True, text=True, timeout=30
            )
        # 전체 설정과 stderr는 출력하지 않고 관심 플래그만 비교한다.
        self.assertEqual(result.returncode, 0, "docker compose config must accept the CI dummy environment")
        configuration = json.loads(result.stdout)
        flag = configuration["services"]["backend"]["environment"]["PLATFORM_AI_SPEND_ENABLED"]
        self.assertEqual(flag, "true" if enabled else "false")
        quota = configuration["services"]["backend"]["environment"]["AGENT_QUOTA_MAX_INPUT_TOKENS"]
        self.assertEqual(quota, str(input_quota if input_quota is not None else 100000))

    def test_base_defaults_to_disabled(self):
        self.assert_spending_flag(production=False, enabled=False)

    def test_base_forwards_explicit_enable(self):
        self.assert_spending_flag(production=False, enabled=True)

    def test_production_defaults_to_disabled(self):
        self.assert_spending_flag(production=True, enabled=False)

    def test_production_forwards_explicit_enable(self):
        self.assert_spending_flag(production=True, enabled=True)

    def test_explicit_lower_operator_quota_is_preserved(self):
        for production in (False, True):
            with self.subTest(production=production):
                self.assert_spending_flag(production=production, enabled=True, input_quota=50000)


if __name__ == "__main__":
    unittest.main()
