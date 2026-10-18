"""양쪽 CI 성공과 Agent 선행 배포를 공동 배포의 필수 조건으로 유지한다."""

import re
import unittest
from pathlib import Path


class ProductionDeploymentOrderTest(unittest.TestCase):
    def test_deployments_require_automation_checks(self):
        text = (Path(__file__).parents[1] / "workflows/production-auto-cd.yml").read_text(
            encoding="utf-8"
        )
        for job in ("deploy-agent", "deploy-backend"):
            block = re.search(
                r"^  " + job + r":\n(.*?)(?=^  [a-z][a-z-]*:|\Z)", text, re.M | re.S
            ).group(1)
            self.assertIn("      - automation-ci\n", block)
            self.assertIn("needs.automation-ci.result == 'success'", block)

    def test_agent_waits_for_backend_tests_when_both_services_change(self):
        text = (Path(__file__).parents[1] / "workflows/production-auto-cd.yml").read_text(encoding="utf-8")
        block = re.search(
            r"^  deploy-agent:\n(.*?)(?=^  [a-z][a-z-]*:|\Z)", text, re.M | re.S
        ).group(1)
        needs = block.split("    if:", 1)[0]
        self.assertIn("      - backend-ci\n", needs)
        self.assertIn("needs.agent-ci.result == 'success'", block)
        self.assertIn(
            "(needs.changes.outputs.backend != 'true' || needs.backend-ci.result == 'success')",
            block
        )
        self.assertIn(
            "(needs.contracts-ci.result == 'success' || needs.contracts-ci.result == 'skipped')",
            block
        )

    def test_backend_remains_after_successful_agent_deploy(self):
        text = (Path(__file__).parents[1] / "workflows/production-auto-cd.yml").read_text(encoding="utf-8")
        block = text.split("  deploy-backend:\n", 1)[1]
        self.assertIn("      - deploy-agent\n", block)
        self.assertIn("needs.backend-ci.result == 'success'", block)
        self.assertIn(
            "(needs.changes.outputs.agent != 'true' || needs.deploy-agent.result == 'success')",
            block
        )


if __name__ == "__main__":
    unittest.main()
