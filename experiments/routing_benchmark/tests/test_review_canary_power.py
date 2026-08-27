from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from routing_benchmark.review_canary_power import evaluate_review_canary_power, wilson_bounds


def test_zero_error_wilson_gate_requires_about_381_audits() -> None:
    _, upper_380 = wilson_bounds(np.array([0]), 380)
    _, upper_381 = wilson_bounds(np.array([0]), 381)

    assert upper_380[0] > 0.01
    assert upper_381[0] <= 0.01


def test_canary_power_report_includes_plot_table(tmp_path: Path) -> None:
    outputs = evaluate_review_canary_power(tmp_path, trials=200, seed=42)

    assert len(outputs) == 4
    assert all(path.exists() for path in outputs)
    report = json.loads(outputs[0].read_text(encoding="utf-8"))
    assert report["method"]["otherwise"] == "INCONCLUSIVE"
    assert len(report["selected"]) == 7
