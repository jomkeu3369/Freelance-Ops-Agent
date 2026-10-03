"""Static checks plus optional local Compose validation; no database is started."""
from pathlib import Path
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
REQUIRED = {
    "docker-compose.yaml": {"APP_DB_PASSWORD", "AGENT_DB_PASSWORD", "APP_AUTH_JWT_SECRET"},
    "docker-compose-infra.yaml": {"POSTGRES_PASSWORD", "APP_DB_PASSWORD", "AGENT_DB_PASSWORD"},
}
ALL_NAMES = set().union(*REQUIRED.values())

class LocalPasswordConfigurationTest(unittest.TestCase):
    def test_compose_requires_nonempty_password_variables_without_defaults(self):
        for filename, names in REQUIRED.items():
            source = (ROOT / filename).read_text()
            for name in names:
                self.assertIn("${" + name + ":?", source, f"{filename}: {name} must be required")
                self.assertNotRegex(source, r"\$\{" + name + r":-[^}]*\}")

    def test_direct_backend_has_no_password_fallback(self):
        source = (ROOT / "backend/src/main/resources/application.yml").read_text()
        self.assertRegex(source, r"(?m)^\s+password: \$\{DB_PASSWORD\}$")
        self.assertNotRegex(source, r"\$\{DB_PASSWORD:[^}]*\}")

    def test_auth_configuration_has_no_usable_fallback(self):
        source = (ROOT / "backend/src/main/resources/application.yml").read_text()
        self.assertIn("jwt-secret: ${APP_AUTH_JWT_SECRET}", source)
        self.assertNotRegex(source, r"\$\{APP_AUTH_JWT_SECRET:[^}]*\}")
        bean = (ROOT / "backend/src/main/java/com/freelanceops/backend/global/config/AuthSecurityConfig.java").read_text()
        self.assertIn('@Value("${app.auth.jwt-secret}")', bean)
        self.assertNotIn("DEVELOPMENT_SECRET", bean)

    def test_example_keeps_password_values_empty(self):
        source = (ROOT / ".env.example").read_text()
        for name in ALL_NAMES:
            self.assertRegex(source, r"(?m)^" + name + r"=$")

    @unittest.skipUnless(shutil.which("docker"), "Docker is unavailable; Compose execution not verified")
    def test_compose_missing_empty_and_temporary_values(self):
        # Disposable values only satisfy interpolation. They are never used for a real account.
        clean = {key: value for key, value in os.environ.items() if key not in ALL_NAMES}
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / "empty.env"
            env_file.write_text("")
            for filename, names in REQUIRED.items():
                fixture = {name: secrets.token_urlsafe(24) for name in ALL_NAMES}
                command = ["docker", "compose", "--env-file", str(env_file), "-f", str(ROOT / filename), "config", "--quiet"]
                good = subprocess.run(command, cwd=ROOT, env=clean | fixture, capture_output=True, timeout=30)
                self.assertEqual(good.returncode, 0, f"{filename}: supplied configuration did not validate")
                for name in names:
                    for empty in (False, True):
                        candidate = dict(fixture)
                        if empty:
                            candidate[name] = ""
                        else:
                            candidate.pop(name)
                        result = subprocess.run(command, cwd=ROOT, env=clean | candidate, capture_output=True, timeout=30)
                        self.assertNotEqual(result.returncode, 0, f"{filename}: {name} should be mandatory")
                        self.assertIn(name.encode(), result.stderr)

if __name__ == "__main__":
    unittest.main(verbosity=2)
