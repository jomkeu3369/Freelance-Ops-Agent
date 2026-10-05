"""Keep coordinated releases behind both service test gates."""
import re
import unittest
from pathlib import Path


class ProductionDeploymentOrderTest(unittest.TestCase):
    def test_agent_waits_for_backend_tests_when_both_services_change(self):
        text = (Path(__file__).parents[1] / "workflows/production-auto-cd.yml").read_text()
        block = re.search(r"^  deploy-agent:\n(.*?)(?=^  [a-z][a-z-]*:|\Z)", text, re.M | re.S).group(1)
        needs = block.split("    if:", 1)[0]
        self.assertIn("      - backend-ci\n", needs)
        self.assertIn("needs.agent-ci.result == 'success'", block)
        self.assertIn("(needs.changes.outputs.backend != 'true' || needs.backend-ci.result == 'success')", block)
        self.assertIn("(needs.contracts-ci.result == 'success' || needs.contracts-ci.result == 'skipped')", block)

    def test_backend_remains_after_successful_agent_deploy(self):
        text = (Path(__file__).parents[1] / "workflows/production-auto-cd.yml").read_text()
        block = text.split("  deploy-backend:\n", 1)[1]
        self.assertIn("      - deploy-agent\n", block)
        self.assertIn("needs.backend-ci.result == 'success'", block)
        self.assertIn("(needs.changes.outputs.agent != 'true' || needs.deploy-agent.result == 'success')", block)


if __name__ == "__main__":
    unittest.main()
