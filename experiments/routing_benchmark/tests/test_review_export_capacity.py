from __future__ import annotations

import json
from pathlib import Path

from routing_benchmark.review_export_capacity import (
    evaluate_review_export_capacity,
    scan_work_rows,
    simulate_cohort_stability,
)


def test_keyset_scan_work_is_linear() -> None:
    offset, keyset = scan_work_rows(1_000_000)

    assert keyset == 1_000_000
    assert offset / keyset == 500.5


def test_fixed_snapshot_eliminates_moving_cohort_drift() -> None:
    rows = simulate_cohort_stability(trials=500, seed=42)
    moving = next(row for row in rows if row["strategy"] == "moving_keyset")
    fixed = next(row for row in rows if row["strategy"] == "fixed_captured_at_snapshot")

    assert moving["mean_final_population_omissions"] > 90
    assert moving["reproducibility_failure_rate"] == 1
    assert fixed["mean_final_population_omissions"] == 0
    assert fixed["reproducibility_failure_rate"] == 0


def test_export_capacity_report_includes_plot_table(tmp_path: Path) -> None:
    outputs = evaluate_review_export_capacity(tmp_path, trials=100, seed=42)

    assert len(outputs) == 4
    assert all(path.exists() for path in outputs)
    report = json.loads(outputs[0].read_text(encoding="utf-8"))
    assert report["scan_work"][-1]["offset_to_keyset_work_ratio"] == 500.5
