from __future__ import annotations

import json
from pathlib import Path

from routing_benchmark.collection_planning import plan_collection


def test_sparse_risk_routes_require_more_reviews(tmp_path: Path) -> None:
    outputs = plan_collection(tmp_path, trials=100, seed=42)

    assert len(outputs) == 4
    assert all(path.exists() for path in outputs)
    report = json.loads(outputs[0].read_text(encoding="utf-8"))
    required = {
        item["scenario"]: item["minimum_reviews_for_95pct_structural_gate"]
        for item in report["summaries"]
    }
    assert required["balanced"] < required["expected_mix"] < required["sparse_risk_routes"]
