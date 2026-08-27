from __future__ import annotations

import json
from pathlib import Path

from routing_benchmark.review_sampling import evaluate_review_sampling


def test_risk_stratification_reduces_required_reviews(tmp_path: Path) -> None:
    outputs = evaluate_review_sampling(tmp_path, trials=100, seed=42)

    report = json.loads(outputs[0].read_text(encoding="utf-8"))
    summaries = {item["strategy"]: item for item in report["summaries"]}
    natural = summaries["natural_only"]["minimum_reviews_for_95pct_gate"]
    balanced = summaries["50pct_natural_50pct_risk"]["minimum_reviews_for_95pct_gate"]
    assert balanced < natural
    assert summaries["50pct_natural_50pct_risk"]["review_reduction_vs_natural"] > 0.5
    assert all(path.exists() for path in outputs)
