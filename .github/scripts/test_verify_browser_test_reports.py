"""Offline checks for the mandatory connected-browser execution gate."""
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from verify_browser_test_reports import validate


class BrowserReportGateTest(unittest.TestCase):
    def errors(self, cases: str, minimum: int = 1) -> list[str]:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "junit.xml"
            path.write_text(f"<testsuites><testsuite>{cases}</testsuite></testsuites>")
            with redirect_stdout(StringIO()):
                return validate(path, {"tests/browser/connected.spec.mjs": minimum})

    def test_actual_required_execution_is_accepted(self):
        self.assertEqual([], self.errors('<testcase classname="tests/browser/connected.spec.mjs" />'))

    def test_missing_or_reduced_suite_is_rejected(self):
        self.assertTrue(self.errors('<testcase classname="tests/browser/other.spec.mjs" />'))
        self.assertTrue(self.errors('<testcase classname="tests/browser/connected.spec.mjs" />', minimum=2))

    def test_skipped_required_execution_is_rejected(self):
        self.assertTrue(self.errors('<testcase classname="tests/browser/connected.spec.mjs"><skipped /></testcase>'))

    def test_failed_required_execution_is_rejected(self):
        for kind in ("failure", "error"):
            self.assertTrue(self.errors(f'<testcase classname="tests/browser/connected.spec.mjs"><{kind} /></testcase>'))

    def test_unrelated_skips_do_not_hide_required_execution(self):
        self.assertEqual([], self.errors('<testcase classname="tests/browser/other.spec.mjs"><skipped /></testcase>'
            '<testcase classname="tests/browser/connected.spec.mjs" />'))

    def test_path_matching_does_not_accept_a_similar_file(self):
        self.assertTrue(self.errors('<testcase classname="tests/browser/unconnected.spec.mjs" />'))


if __name__ == "__main__":
    unittest.main()
