import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import isolated_backend_load as L
import isolated_quotation_pages as P


class PaginationHarnessTest(unittest.TestCase):
    def test_expected_full_list_count_is_case_specific(self):
        with patch.object(L, "CASE", "baseline"):
            self.assertEqual([L.expected_query_count(n) for n in (10, 100, 1000)], [31, 301, 3001])
        with patch.object(L, "CASE", "optimized"):
            self.assertEqual([L.expected_query_count(n) for n in (10, 100, 101, 1000)], [4, 4, 7, 31])

    def test_first_page_requires_exact_order_limit_and_cursor(self):
        user = {"workspaceId": "w"}
        ids = [str(n) for n in range(100)]
        route = P.page_route(user, "/api/v2/workspaces/w", "p", ids)
        with patch.object(L, "quote_valid", return_value=True):
            good = {"items": [{"id": n} for n in ids[:50]], "nextCursor": "opaque"}
            self.assertTrue(route[2](good))
            self.assertFalse(route[2]({**good, "nextCursor": None}))
            self.assertFalse(route[2]({**good, "items": list(reversed(good["items"]))}))
            self.assertFalse(route[2]({**good, "items": good["items"][:1] * 50}))
            self.assertFalse(route[2]({**good, "items": good["items"] + [{"id": "50"}]}))

    def test_terminal_page_requires_null_cursor(self):
        user = {"workspaceId": "w"}
        with patch.object(L, "quote_valid", return_value=True):
            validator = P.page_route(user, "/api/v2/workspaces/w", "p", ["1"])[2]
            self.assertTrue(validator({"items": [{"id": "1"}], "nextCursor": None}))
            self.assertFalse(validator({"items": [{"id": "1"}], "nextCursor": "more"}))

    def test_control_failures_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError, "test-only"):
            P.require(False, "test-only")


if __name__ == '__main__':
    unittest.main()
