from __future__ import annotations

import json
from pathlib import Path

from routing_benchmark.review_sampling_bias import (
    evaluate_review_sampling_bias,
    evaluate_sampling_bias,
)


def test_post_stratification_reduces_oversampling_bias() -> None:
    _, summary = evaluate_sampling_bias(trials=500, seed=42)
    naive = next(row for row in summary if row["strategy"] == "naive_50_50" and row["metric"] == "macro_f1")
    weighted = next(row for row in summary if row["strategy"] == "post_stratified" and row["metric"] == "macro_f1")

    assert weighted["mean_absolute_error"] < naive["mean_absolute_error"] / 5


def test_sampling_bias_report_includes_plot_table(tmp_path: Path) -> None:
    outputs = evaluate_review_sampling_bias(tmp_path, trials=100, seed=42)

    assert len(outputs) == 4
    assert all(path.exists() for path in outputs)
    report = json.loads(outputs[0].read_text(encoding="utf-8"))
    assert report["method"]["population_natural_prior"] == 0.9
    assert len(report["summary"]) == 8
