import importlib.util
import json
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

    def test_deep_page_probe_checks_actual_tuple_sql_and_rows(self):
        statements = [
            {"query": "select q.* from app.quotation q where (q.created_at,q.id)<($3,$4)", "calls": 1, "rows": 51},
            {"query": "select i.* from app.quotation_item i", "calls": 1, "rows": 300},
            {"query": "select a.* from app.quotation_assumption a", "calls": 1, "rows": 150},
            {"query": "select e.* from app.quotation_evidence e", "calls": 1, "rows": 150},
        ]
        with patch.object(L, "pg", side_effect=["", json.dumps(statements), "", json.dumps(statements)]), patch.object(L, "request", return_value={"valid": True}):
            probes = P.page_probe(("deep", "/api/v2/x", None), "not-a-real-token", 1000, remaining_count=100, require_tuple=True)
            self.assertEqual(probes[0]["quotation_family_rows"], 651)
            self.assertTrue(probes[0]["actual_tuple_sql_verified"])
        statements[0]["query"] = "select q.* from app.quotation q where q.created_at<$3 or q.id<$4"
        with patch.object(L, "pg", side_effect=["", json.dumps(statements)]), patch.object(L, "request", return_value={"valid": True}):
            with self.assertRaisesRegex(RuntimeError, "tuple boundary"):
                P.page_probe(("deep", "/api/v2/x", None), "not-a-real-token", 1000, remaining_count=100, require_tuple=True)

    def test_control_failures_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError, "test-only"):
            P.require(False, "test-only")


if __name__ == '__main__':
    unittest.main()
