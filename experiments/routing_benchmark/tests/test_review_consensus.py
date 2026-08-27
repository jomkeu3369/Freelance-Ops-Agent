from __future__ import annotations

import json
from pathlib import Path

from routing_benchmark.review_consensus import evaluate_review_consensus, evaluate_strategy


def test_risk_weighted_dual_review_reduces_label_error() -> None:
    single = evaluate_strategy(0.02, 0.08, 0.0, 0.0, trials=500, seed=42)
    weighted = evaluate_strategy(0.02, 0.08, 0.25, 1.0, trials=500, seed=42)

    assert single["p95_label_error_rate"] > 0.04
    assert weighted["p95_label_error_rate"] <= 0.01
    assert weighted["mean_reviews_per_gold_label"] < 1.75


def test_consensus_report_includes_plot_table(tmp_path: Path) -> None:
    outputs = evaluate_review_consensus(tmp_path, trials=100, seed=42)

    assert len(outputs) == 4
    assert all(path.exists() for path in outputs)
    report = json.loads(outputs[0].read_text(encoding="utf-8"))
    assert [row["scenario"] for row in report["selected"]] == ["optimistic", "expected", "stressed"]
