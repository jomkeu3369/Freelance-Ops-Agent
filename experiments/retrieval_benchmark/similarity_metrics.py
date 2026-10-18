from __future__ import annotations

from collections.abc import Sequence

import numpy as np

if __package__:
    from .similarity_types import Chunk, LinearGate, QueryCase
else:
    from similarity_types import Chunk, LinearGate, QueryCase

FEATURE_NAMES = (
    "s1",
    "s2",
    "s3",
    "top3_mean",
    "top3_min",
    "semantic_gap",
    "semantic_dispersion",
    "bm25_top",
    "bm25_mean3",
    "centroid_similarity",
    "cluster_margin",
    "cluster_agreement",
    "centroid_radius_ratio",
    "distinct_documents",
)


def fit_linear_gate(rows: Sequence[dict[str, float]], labels: Sequence[bool], feature_names: Sequence[str], *, learning_rate: float = 0.05, steps: int = 2_000, l2: float = 0.01) -> LinearGate:  # noqa: E501
    x = np.asarray([[row[name] for name in feature_names] for row in rows], dtype=np.float64)
    y = np.asarray(labels, dtype=np.float64)
    if len(np.unique(y)) < 2:
        raise ValueError("학습 split에는 answerable=True/False 사례가 모두 필요합니다.")
    mean = x.mean(axis=0)
    scale = x.std(axis=0)
    scale[scale < 1e-8] = 1.0
    standardized = (x - mean) / scale
    weights = np.zeros(standardized.shape[1], dtype=np.float64)
    bias = 0.0
    for _ in range(steps):
        logits = np.clip(standardized @ weights + bias, -30.0, 30.0)
        probabilities = 1.0 / (1.0 + np.exp(-logits))
        error = probabilities - y
        weights -= learning_rate * ((standardized.T @ error) / len(y) + l2 * weights)
        bias -= learning_rate * float(error.mean())
    return LinearGate(tuple(feature_names), mean, scale, weights, bias)


def choose_threshold(labels: Sequence[bool], scores: Sequence[float], *, max_false_accept_rate: float = 0.10) -> float:
    y = np.asarray(labels, dtype=bool)
    probabilities = np.asarray(scores, dtype=np.float64)
    candidates = np.unique(np.concatenate(([0.0], probabilities, [1.0 + 1e-9])))
    feasible: list[tuple[float, float, float]] = []
    negatives = max(int((~y).sum()), 1)
    for threshold in candidates:
        accepted = probabilities >= threshold
        tp = int(np.sum(accepted & y))
        fp = int(np.sum(accepted & ~y))
        fn = int(np.sum(~accepted & y))
        precision = tp / max(tp + fp, 1)
        recall = tp / max(tp + fn, 1)
        f1 = 2.0 * precision * recall / max(precision + recall, 1e-12)
        false_accept_rate = fp / negatives
        if false_accept_rate <= max_false_accept_rate:
            feasible.append((f1, recall, float(threshold)))
    if not feasible:
        return float(probabilities.max() + 1e-9)
    return max(feasible, key=lambda item: (item[0], item[1], item[2]))[2]


def classification_metrics(labels: Sequence[bool], scores: Sequence[float], threshold: float) -> dict[str, float | int]:
    y = np.asarray(labels, dtype=bool)
    probabilities = np.asarray(scores, dtype=np.float64)
    accepted = probabilities >= threshold
    tp = int(np.sum(accepted & y))
    fp = int(np.sum(accepted & ~y))
    tn = int(np.sum(~accepted & ~y))
    fn = int(np.sum(~accepted & y))
    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    return {
        "n": len(y),
        "threshold": threshold,
        "accuracy": (tp + tn) / max(len(y), 1),
        "precision": precision,
        "recall": recall,
        "f1": 2.0 * precision * recall / max(precision + recall, 1e-12),
        "coverage": float(accepted.mean()) if len(accepted) else 0.0,
        "false_accept_rate": fp / max(int((~y).sum()), 1),
        "false_reject_rate": fn / max(int(y.sum()), 1),
        "brier": float(np.mean((probabilities - y.astype(float)) ** 2)),
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
    }


def retrieval_metrics(cases: Sequence[QueryCase], retrieved: Sequence[Sequence[int]], chunks: Sequence[Chunk]) -> dict[str, float]:  # noqa: E501
    recalls: list[float] = []
    evidence_coverages: list[float] = []
    reciprocal_ranks: list[float] = []

    for case, indices in zip(cases, retrieved, strict=True):
        relevant = set(case.relevant_document_ids)
        if not relevant:
            continue

        ranked_documents = [chunks[index].document_id for index in indices]
        recalls.append(float(any(document_id in relevant for document_id in ranked_documents)))
        evidence_coverages.append(len(relevant.intersection(ranked_documents)) / len(relevant))
        rank = next(
            (
                rank
                for rank, document_id in enumerate(ranked_documents, 1)
                if document_id in relevant
            ),
            None
        )
        reciprocal_ranks.append(0.0 if rank is None else 1.0 / rank)

    return {
        "recall_at_3": float(np.mean(recalls)) if recalls else float("nan"),
        "evidence_coverage_at_3": float(np.mean(evidence_coverages))
        if evidence_coverages
        else float("nan"),
        "mrr": float(np.mean(reciprocal_ranks)) if reciprocal_ranks else float("nan"),
    }


METHOD_FEATURES: dict[str, tuple[str, ...]] = {
    "A_top1": ("s1",),
    "B_top3_mean": ("top3_mean",),
    "C_semantic_bm25": ("s1", "top3_mean", "bm25_top", "bm25_mean3"),
    "D_plus_cluster": (
        "s1",
        "top3_mean",
        "bm25_top",
        "centroid_similarity",
        "cluster_margin",
        "cluster_agreement",
        "centroid_radius_ratio",
    ),
    "E_calibrated_gate": FEATURE_NAMES,
}
