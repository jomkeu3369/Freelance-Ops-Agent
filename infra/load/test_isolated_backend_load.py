import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("load", Path(__file__).with_name("isolated_backend_load.py"))
LOAD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LOAD)


class HarnessTest(unittest.TestCase):
    def test_nearest_rank(self):
        self.assertEqual(LOAD.percentile(list(range(1, 101)), .95), 95)
        self.assertEqual(LOAD.percentile([1, 2], .99), 2)
        self.assertIsNone(LOAD.percentile([], .95))

    def test_reject_external_paths_before_network(self):
        for value in ("https://example.com", "/api/v2/https://example.com", "/agent-runs"):
            with self.assertRaises(ValueError):
                LOAD.send("GET", value)

    def test_expected_4xx_is_not_business_success(self):
        rows = [{"route": "test", "latency_ms": 10, "schedule_lag_ms": 0, "valid": False,
                 "status": 401, "bytes": 10}]
        result = LOAD.aggregate(rows, 1, 0, 1)
        self.assertFalse(result["observed_gate_pass"])
        self.assertEqual(result["routes"]["test"]["unexpected_4xx"], 1)
        self.assertEqual(result["routes"]["test"]["errors"], 1)

    def test_429_and_semantic_failures_separate(self):
        rows = [{"route": "test", "latency_ms": 10, "schedule_lag_ms": 0, "valid": False,
                 "status": status, "bytes": 10} for status in (429, 500, 0, 200)]
        result = LOAD.aggregate(rows, 1, 1, 4)["routes"]["test"]
        self.assertEqual(result["http_429"], 1)
        self.assertEqual(result["server_5xx"], 1)
        self.assertEqual(result["transport_errors"], 1)
        self.assertEqual(result["semantic_failures"], 1)
        self.assertFalse(result["observed_gate_pass"])

    def test_low_target_attainment_fails_gate(self):
        rows = [{"route": "test", "latency_ms": 10, "schedule_lag_ms": 0, "valid": True,
                 "status": 200, "bytes": 10}]
        self.assertFalse(LOAD.aggregate(rows, 2, 0, 1)["observed_gate_pass"])

    def test_dispatch_lag_fails_gate(self):
        rows = [{"route": "test", "latency_ms": 10, "schedule_lag_ms": 150, "valid": True,
                 "status": 200, "bytes": 10}]
        self.assertFalse(LOAD.aggregate(rows, 1, 0, 1)["observed_gate_pass"])

    def test_drop_fails_gate(self):
        rows = [{"route": "test", "latency_ms": 10, "schedule_lag_ms": 0, "valid": True,
                 "status": 200, "bytes": 10}]
        self.assertTrue(LOAD.aggregate(rows, 1, 0, 1)["observed_gate_pass"])
        self.assertFalse(LOAD.aggregate(rows, 1, 1, 1)["observed_gate_pass"])


if __name__ == "__main__":
    unittest.main()
