"""검색 실험 실행과 기존 호출 경로를 제공한다."""

from __future__ import annotations

import time
from collections.abc import Sequence
from typing import Any

import numpy as np

from embeddings import HashingEmbedder as HashingEmbedder
from embeddings import OpenAIEmbedder as OpenAIEmbedder
from embeddings import embed_corpus as embed_corpus
from embeddings import embed_queries as embed_queries
from embeddings import normalize_rows as normalize_rows
from similarity_index import BM25Index as BM25Index
from similarity_index import _deduplicated_top_indices as _deduplicated_top_indices
from similarity_index import _spherical_kmeans_once as _spherical_kmeans_once
from similarity_index import cosine_silhouette as cosine_silhouette
from similarity_index import extract_features as extract_features
from similarity_index import select_clusters as select_clusters
from similarity_index import spherical_kmeans as spherical_kmeans
from similarity_metrics import FEATURE_NAMES as FEATURE_NAMES
from similarity_metrics import METHOD_FEATURES as METHOD_FEATURES
from similarity_metrics import choose_threshold as choose_threshold
from similarity_metrics import classification_metrics as classification_metrics
from similarity_metrics import fit_linear_gate as fit_linear_gate
from similarity_metrics import retrieval_metrics as retrieval_metrics
from similarity_plots import plot_benchmark_report as plot_benchmark_report
from similarity_types import Chunk as Chunk
from similarity_types import ClusterResult as ClusterResult
from similarity_types import Embedder as Embedder
from similarity_types import LinearGate as LinearGate
from similarity_types import QueryCase as QueryCase
from text_chunks import TOKEN_PATTERN as TOKEN_PATTERN
from text_chunks import chunk_text as chunk_text
from text_chunks import chunks_from_paths as chunks_from_paths
from text_chunks import chunks_from_texts as chunks_from_texts
from text_chunks import read_text as read_text
from text_chunks import tokenize as tokenize


def run_benchmark(chunks: Sequence[Chunk], corpus_vectors: np.ndarray, cases: Sequence[QueryCase], query_vectors: np.ndarray, *, clusters: ClusterResult | None = None, max_false_accept_rate: float = 0.10, uncertain_band: float = 0.10) -> dict[str, Any]:  # noqa: E501
    if len(cases) != len(query_vectors):
        raise ValueError("case 수와 query embedding 수가 다릅니다.")

    required = {"train", "validation", "test"}
    actual = {case.split for case in cases}

    if not required.issubset(actual):
        raise ValueError("train, validation, test split이 모두 필요합니다.")

    clusters = clusters or select_clusters(corpus_vectors)

    bm25 = BM25Index([chunk.text for chunk in chunks])
    rows: list[dict[str, float]] = []
    retrieved: list[list[int]] = []
    feature_started = time.perf_counter()

    for case, query_vector in zip(cases, query_vectors, strict=True):
        row, indices = extract_features(
            case.query, query_vector, chunks, corpus_vectors, clusters, bm25
        )
        rows.append(row)
        retrieved.append(indices)

    feature_ms = (time.perf_counter() - feature_started) * 1_000.0
    indices_by_split = {
        split: [index for index, case in enumerate(cases) if case.split == split]
        for split in required
    }

    results: list[dict[str, Any]] = []
    method_details: dict[str, dict[str, Any]] = {}
    gates: dict[str, LinearGate] = {}
    test_probabilities: dict[str, np.ndarray] = {}

    for method, feature_names in METHOD_FEATURES.items():
        train_indices = indices_by_split["train"]
        validation_indices = indices_by_split["validation"]
        test_indices = indices_by_split["test"]

        gate = fit_linear_gate(
            [rows[index] for index in train_indices],
            [cases[index].answerable for index in train_indices],
            feature_names
        )
        validation_scores = gate.predict_proba([rows[index] for index in validation_indices])
        threshold = choose_threshold(
            [cases[index].answerable for index in validation_indices],
            validation_scores,
            max_false_accept_rate=max_false_accept_rate
        )
        test_scores = gate.predict_proba([rows[index] for index in test_indices])
        metrics = classification_metrics(
            [cases[index].answerable for index in test_indices], test_scores, threshold
        )
        results.append({"method": method, **metrics})

        method_details[method] = {
            "scores": test_scores.tolist(),
            "threshold": threshold,
            "accepted": (test_scores >= threshold).tolist(),
        }

        gates[method] = gate
        test_probabilities[method] = test_scores

    test_indices = indices_by_split["test"]
    llm_available = all(cases[index].llm_accept is not None for index in test_indices)

    if llm_available:
        labels = [cases[index].answerable for index in test_indices]
        llm_scores = np.asarray([float(bool(cases[index].llm_accept)) for index in test_indices])
        results.append(
            {"method": "F_llm_evaluator", **classification_metrics(labels, llm_scores, 0.5)}
        )

        method_details["F_llm_evaluator"] = {
            "scores": llm_scores.tolist(),
            "threshold": 0.5,
            "accepted": (llm_scores >= 0.5).tolist(),
        }

        e_result = next(result for result in results if result["method"] == "E_calibrated_gate")
        threshold = float(e_result["threshold"])
        e_scores = test_probabilities["E_calibrated_gate"]

        lower = max(0.0, threshold - uncertain_band)
        upper = min(1.0, threshold + uncertain_band)

        hybrid_scores = e_scores.copy()
        fallback_count = 0
        for position, case_index in enumerate(test_indices):
            if lower <= e_scores[position] <= upper:
                hybrid_scores[position] = float(bool(cases[case_index].llm_accept))
                fallback_count += 1

        hybrid_metrics = classification_metrics(labels, hybrid_scores, threshold)
        results.append(
            {
                "method": "G_gate_llm_fallback",
                **hybrid_metrics,
                "llm_fallback_count": fallback_count,
                "llm_fallback_rate": fallback_count / max(len(test_indices), 1),
            }
        )

        method_details["G_gate_llm_fallback"] = {
            "scores": hybrid_scores.tolist(),
            "threshold": threshold,
            "accepted": (hybrid_scores >= threshold).tolist(),
        }

    test_cases = [cases[index] for index in test_indices]
    test_retrieved = [retrieved[index] for index in test_indices]
    return {
        "cluster": {
            "chosen_k": clusters.chosen_k,
            "silhouette": clusters.silhouette,
            "sizes": np.bincount(clusters.labels, minlength=clusters.chosen_k).tolist(),
            "radii": clusters.radii.tolist(),
            "candidates": clusters.candidates,
        },
        "retrieval": retrieval_metrics(test_cases, test_retrieved, chunks),
        "methods": results,
        "method_details": method_details,
        "test_case_ids": [case.case_id for case in test_cases],
        "test_labels": [case.answerable for case in test_cases],
        "test_categories": [case.category for case in test_cases],
        "feature_extraction_ms_total": feature_ms,
        "feature_extraction_ms_per_query": feature_ms / max(len(cases), 1),
        "llm_methods_included": llm_available,
        "features": rows,
        "retrieved_chunk_ids": [
            [chunks[index].chunk_id for index in indices] for indices in retrieved
        ],
        "gates": gates,
    }


def compact_results(report: dict[str, Any]) -> list[dict[str, Any]]:
    columns = (
        "method",
        "accuracy",
        "precision",
        "recall",
        "f1",
        "coverage",
        "false_accept_rate",
        "false_reject_rate",
        "brier",
        "llm_fallback_rate",
    )
    return [
        {
            key: round(value, 4) if isinstance(value, float) else value
            for key in columns
            if (value := row.get(key)) is not None
        }
        for row in report["methods"]
    ]
