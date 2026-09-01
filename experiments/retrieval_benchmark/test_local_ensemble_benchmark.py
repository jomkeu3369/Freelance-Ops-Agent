from __future__ import annotations

import numpy as np

from run_local_ensemble_benchmark import decision_metrics, ensemble_decisions


def test_ensemble_only_resolves_when_both_models_agree() -> None:
    verifier = np.asarray([0.95, 0.95, 0.01, 0.01, 0.50])
    reader = np.asarray([10.0, 0.0, -10.0, 10.0, 0.0])

    accepted, rejected, fallback = ensemble_decisions(
        verifier,
        reader,
        verifier_reject=0.1,
        verifier_accept=0.9,
        reader_reject=-5.0,
        reader_accept=5.0,
    )

    assert accepted.tolist() == [True, False, False, False, False]
    assert rejected.tolist() == [False, False, True, False, False]
    assert fallback.tolist() == [False, True, False, True, True]

    metrics = decision_metrics(
        np.asarray([True, False, False, True, True]), accepted, rejected, fallback
    )
    assert metrics["local_resolved_accuracy"] == 1.0
