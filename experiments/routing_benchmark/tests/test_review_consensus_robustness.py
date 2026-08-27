from __future__ import annotations

import json
from pathlib import Path

from routing_benchmark.review_consensus_robustness import (
    evaluate_consensus_robustness,
    evaluate_robust_strategy,
)


def test_shared_errors_break_unaudited_consensus_and_audit_recovers() -> None:
    unaudited = evaluate_robust_strategy(0.02, 0.08, 0.10, 0.25, 0.005, 0.25, 0.0, 0.0, 1_000, 42)
    audited = evaluate_robust_strategy(0.02, 0.08, 0.10, 0.25, 0.005, 0.50, 0.10, 0.50, 1_000, 42)

    assert unaudited["p95_label_error_rate"] > 0.01
    assert audited["p95_label_error_rate"] < unaudited["p95_label_error_rate"]


def test_robustness_report_includes_plot_table(tmp_path: Path) -> None:
    outputs = evaluate_consensus_robustness(tmp_path, trials=100, seed=42)

    assert len(outputs) == 4
    assert all(path.exists() for path in outputs)
    report = json.loads(outputs[0].read_text(encoding="utf-8"))
    assert [row["scenario"] for row in report["selected"]] == ["independent", "expected_shared", "stressed_shared"]
    assert report["recommended_canary"]["natural_audit_fraction"] == 0.05
    assert report["recommended_canary"]["p95_label_error_rate"] <= 0.01
