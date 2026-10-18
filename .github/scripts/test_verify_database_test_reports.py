"""필수 검사의 누락·생략·실패를 차단하는 보고서 검증을 확인한다."""

import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from verify_database_test_reports import expected_suites, validate


class ReportGateTest(unittest.TestCase):
    def test_empty_required_sources_are_rejected(self):
        with redirect_stdout(StringIO()):
            self.assertTrue(validate(set(), []))

    def test_unknown_component_is_rejected(self):
        with self.assertRaises(ValueError):
            expected_suites(Path("."), "unknown")

    def report_errors(self, xml: str) -> list[str]:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "tests.xml"
            path.write_text(xml)
            with redirect_stdout(StringIO()):
                return validate({"tests.integration.test_database"}, [path])

    def test_passed_required_case_is_accepted(self):
        self.assertEqual(
            [],
            self.report_errors(
                '<testsuite><testcase classname="tests.integration.test_database" /></testsuite>'
            )
        )

    def test_missing_required_case_is_rejected(self):
        self.assertTrue(
            self.report_errors('<testsuite><testcase classname="tests.unit" /></testsuite>')
        )

    def test_skipped_required_case_is_rejected(self):
        self.assertTrue(
            self.report_errors(
                '<testsuite><testcase classname="tests.integration.test_database"><skipped /></testcase></testsuite>'
            )
        )

    def test_failed_required_case_is_rejected(self):
        self.assertTrue(
            self.report_errors(
                '<testsuite><testcase classname="tests.integration.test_database"><failure /></testcase></testsuite>'
            )
        )

    def test_error_required_case_is_rejected(self):
        self.assertTrue(
            self.report_errors(
                '<testsuite><testcase classname="tests.integration.test_database"><error /></testcase></testsuite>'
            )
        )

    def test_nested_java_class_is_counted_in_its_required_suite(self):
        with TemporaryDirectory() as directory:
            report = Path(directory) / "TEST-ExampleTest.xml"
            report.write_text(
                '<testsuite><testcase classname="example.RequiredTest$Nested" /></testsuite>',
                encoding="utf-8"
            )
            with redirect_stdout(StringIO()):
                self.assertEqual([], validate({"example.RequiredTest"}, [report]))

    def test_missing_reports_are_rejected(self):
        with redirect_stdout(StringIO()):
            self.assertTrue(validate({"RequiredTest"}, []))

    def test_unrelated_skips_do_not_hide_required_success(self):
        self.assertEqual(
            [],
            self.report_errors(
                '<testsuites><testsuite><testcase classname="tests.optional"><skipped /></testcase><testcase classname="tests.integration.test_database" /></testsuite></testsuites>'
            )
        )

    def test_source_discovery_includes_all_testcontainers_and_attachment_modules(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            java = root / "backend/src/test/java/example"
            java.mkdir(parents=True)
            (java / "PetTest.java").write_text(
                "package example;\n@Testcontainers\nclass PetTest {}"
            )
            (java / "UnitTest.java").write_text("package example;\nclass UnitTest {}")
            integration = root / "agent/tests/integration"
            integration.mkdir(parents=True)
            (integration / "test_registry.py").touch()
            (root / "agent/tests/test_attachment_ocr.py").touch()
            self.assertEqual({"example.PetTest"}, expected_suites(root, "backend"))
            self.assertEqual(
                {"tests.integration.test_registry", "tests.test_attachment_ocr"},
                expected_suites(root, "agent")
            )


if __name__ == "__main__":
    unittest.main()
