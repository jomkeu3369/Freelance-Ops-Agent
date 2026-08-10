from __future__ import annotations

import math
import random
from collections.abc import Sequence
from statistics import median
from typing import Any

import numpy as np
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score


def classification_metrics(y_true: Sequence[int], y_pred: Sequence[int]) -> dict[str, float]:
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y_true, y_pred, average="weighted", zero_division=0)),
        "macro_precision": float(
            precision_score(y_true, y_pred, average="macro", zero_division=0)
        ),
        "macro_recall": float(recall_score(y_true, y_pred, average="macro", zero_division=0)),
    }


def latency_metrics(latencies_ms: Sequence[float], elapsed_seconds: float) -> dict[str, float]:
    values = np.asarray(latencies_ms, dtype=float)
    return {
        "p50_ms": float(np.percentile(values, 50)),
        "p95_ms": float(np.percentile(values, 95)),
        "mean_ms": float(np.mean(values)),
        "throughput_samples_per_second": len(values) / max(elapsed_seconds, 1e-9),
    }


def exact_mcnemar(y_true: Sequence[int], pred_a: Sequence[int], pred_b: Sequence[int]) -> dict[str, Any]:
    """Two-sided exact McNemar test without a SciPy dependency."""
    a_only = sum(a == truth and b != truth for truth, a, b in zip(y_true, pred_a, pred_b))
    b_only = sum(b == truth and a != truth for truth, a, b in zip(y_true, pred_a, pred_b))
    discordant = a_only + b_only
    if discordant == 0:
        p_value = 1.0
    else:
        tail = sum(math.comb(discordant, k) for k in range(min(a_only, b_only) + 1))
        p_value = min(1.0, 2.0 * tail / (2**discordant))
    return {"a_only_correct": a_only, "b_only_correct": b_only, "p_value": p_value}


def bootstrap_f1_delta(
    y_true: Sequence[int],
    pred_a: Sequence[int],
    pred_b: Sequence[int],
    *,
    iterations: int = 2_000,
    seed: int = 42,
) -> dict[str, float]:
    rng = random.Random(seed)
    size = len(y_true)
    deltas: list[float] = []
    for _ in range(iterations):
        indices = [rng.randrange(size) for _ in range(size)]
        truth = [y_true[index] for index in indices]
        a = [pred_a[index] for index in indices]
        b = [pred_b[index] for index in indices]
        deltas.append(
            float(f1_score(truth, b, average="macro", zero_division=0))
            - float(f1_score(truth, a, average="macro", zero_division=0))
        )
    lower, upper = np.percentile(deltas, [2.5, 97.5])
    return {
        "metric": "B_macro_f1_minus_A_macro_f1",
        "median_delta": float(median(deltas)),
        "ci95_low": float(lower),
        "ci95_high": float(upper),
    }

