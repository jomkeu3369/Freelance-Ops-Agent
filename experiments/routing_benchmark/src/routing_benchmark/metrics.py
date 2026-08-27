from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

import numpy as np
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score


def routing_metrics(truth: Sequence[str], predictions: Sequence[str], labels: Sequence[str], sample_weight: Sequence[float] | None = None) -> dict[str, Any]:
    report = classification_report(
        truth, predictions, labels=list(labels), output_dict=True, zero_division=0,
        sample_weight=sample_weight
    )
    return {
        "accuracy": float(accuracy_score(truth, predictions, sample_weight=sample_weight)),
        "macro_f1": float(f1_score(truth, predictions, labels=list(labels), average="macro", zero_division=0, sample_weight=sample_weight)),
        "per_route": {label: report[label] for label in labels},
        "confusion_matrix": confusion_matrix(truth, predictions, labels=list(labels), sample_weight=sample_weight).tolist(),
    }


def latency_metrics(values_ms: Sequence[float]) -> dict[str, float]:
    values = np.asarray(values_ms, dtype=float)
    return {
        "mean_ms": float(np.mean(values)),
        "p50_ms": float(np.percentile(values, 50)),
        "p95_ms": float(np.percentile(values, 95)),
        "throughput_per_second": 1_000 / max(float(np.mean(values)), 1e-9),
    }


def exact_mcnemar(
    truth: Sequence[str], prediction_a: Sequence[str], prediction_b: Sequence[str]
) -> dict[str, Any]:
    a_only = sum(
        a == expected and b != expected for expected, a, b in zip(truth, prediction_a, prediction_b)
    )

    b_only = sum(
        b == expected and a != expected for expected, a, b in zip(truth, prediction_a, prediction_b)
    )

    discordant = a_only + b_only
    if discordant == 0:
        p_value = 1.0

    else:
        tail = sum(math.comb(discordant, k) for k in range(min(a_only, b_only) + 1))
        p_value = min(1.0, 2.0 * tail / (2**discordant))

    return {"a_only_correct": a_only, "b_only_correct": b_only, "p_value": p_value}
