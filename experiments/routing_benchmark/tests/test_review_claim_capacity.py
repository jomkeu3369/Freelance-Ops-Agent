from __future__ import annotations

import json
from pathlib import Path

from routing_benchmark.review_claim_capacity import (
    evaluate_review_claim_capacity,
    simulate_review_day,
)


def test_lease_eliminates_duplicate_review_work() -> None:
    baseline = simulate_review_day(reviewers=8, mean_minutes=5, leased=False, seed=42)
    leased = simulate_review_day(reviewers=8, mean_minutes=5, leased=True, seed=42)

    assert baseline["duplicate_work_rate"] > 0.70
    assert leased["duplicate_work_rate"] == 0
    assert leased["unique_reviews_per_day"] > baseline["unique_reviews_per_day"] * 5


def test_review_claim_report_includes_plot_table(tmp_path: Path) -> None:
    outputs = evaluate_review_claim_capacity(tmp_path, trials=10, seed=42)

    assert len(outputs) == 4
    assert all(path.exists() for path in outputs)
    report = json.loads(outputs[0].read_text(encoding="utf-8"))
    assert len(report["summaries"]) == 24
