from __future__ import annotations

import numpy as np

from run_hybrid_pipeline_benchmark import (
    choose_accept_threshold,
    choose_reject_threshold,
    selective_metrics,
    wilson_upper,
)


def test_wilson_upper_is_conservative_for_small_samples() -> None:
    assert wilson_upper(0, 75) > 0.0
    assert wilson_upper(1, 75) > 1 / 75


def test_selective_thresholds_leave_uncertain_cases_for_fallback() -> None:
    labels = np.asarray([False] * 75 + [True] * 75)
    scores = np.asarray(
        [0.01] * 70 + [0.91, 0.92, 0.93, 0.94, 0.95] + [0.02] * 2 + [0.80] * 73
    )

    accept = choose_accept_threshold(labels, scores, max_false_accept_rate=0.10)
    reject = choose_reject_threshold(labels, scores, max_false_reject_rate=0.10)
    metrics = selective_metrics(labels, scores, reject_threshold=reject, accept_threshold=accept)

    assert reject < accept
    assert metrics["llm_fallback"] > 0
    assert metrics["false_accept_rate"] <= 0.10
    assert metrics["false_reject_rate"] <= 0.10
