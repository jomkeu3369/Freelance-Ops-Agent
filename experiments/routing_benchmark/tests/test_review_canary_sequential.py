from __future__ import annotations

import json
from pathlib import Path

from routing_benchmark.review_canary_sequential import (
    evaluate_review_canary_sequential,
    evaluate_sequential_canary,
)


def test_alpha_spending_reduces_boundary_optional_stopping_error() -> None:
    summaries, _ = evaluate_sequential_canary(trials=10_000, seed=42)
    boundary = [row for row in summaries if row["true_overturn_rate"] == 0.01]
    naive = next(row for row in boundary if row["policy"] == "naive_repeated_95")
    adjusted = next(row for row in boundary if row["policy"] == "alpha_spending")

    assert adjusted["accept_probability"] + adjusted["reject_probability"] <= 0.05
    assert adjusted["accept_probability"] + adjusted["reject_probability"] < naive["accept_probability"] + naive["reject_probability"]


def test_sequential_report_includes_plot_table(tmp_path: Path) -> None:
    outputs = evaluate_review_canary_sequential(tmp_path, trials=500, seed=42)

    assert len(outputs) == 4
    assert all(path.exists() for path in outputs)
    report = json.loads(outputs[0].read_text(encoding="utf-8"))
    assert report["method"]["looks"] == 14
    assert report["method"]["family_wise_looks"] == 28
    assert len(report["summary"]) == 8
