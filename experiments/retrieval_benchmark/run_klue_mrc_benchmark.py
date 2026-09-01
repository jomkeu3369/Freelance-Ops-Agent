from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
from dotenv import find_dotenv, load_dotenv

from similarity_benchmark import (
    OpenAIEmbedder,
    QueryCase,
    chunks_from_texts,
    compact_results,
    embed_corpus,
    embed_queries,
    plot_benchmark_report,
    run_benchmark,
    select_clusters,
)


def load_dataset(path: Path) -> tuple[dict[str, str], list[QueryCase]]:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    documents = {row["document_id"]: row["context"] for row in rows}
    cases = [
        QueryCase(
            case_id=row["case_id"],
            query=row["question"],
            split=row["benchmark_split"],
            answerable=row["answerable"],
            relevant_document_ids=(row["document_id"],) if row["answerable"] else (),
            category="klue_answerable" if row["answerable"] else "klue_unanswerable",
        )
        for row in rows
    ]
    return documents, cases


def metric_from_predictions(labels: np.ndarray, predictions: np.ndarray, metric: str) -> float:
    tp = int(np.sum(predictions & labels))
    fp = int(np.sum(predictions & ~labels))
    fn = int(np.sum(~predictions & labels))
    if metric == "precision":
        return tp / max(tp + fp, 1)
    if metric == "recall":
        return tp / max(tp + fn, 1)
    if metric == "f1":
        precision = tp / max(tp + fp, 1)
        recall = tp / max(tp + fn, 1)
        return 2 * precision * recall / max(precision + recall, 1e-12)
    if metric == "false_accept_rate":
        return fp / max(int((~labels).sum()), 1)
    raise ValueError(metric)


def bootstrap_intervals(report: dict[str, Any], *, samples: int = 2_000, seed: int = 42) -> dict[str, Any]:
    labels = np.asarray(report["test_labels"], dtype=bool)
    rng = np.random.default_rng(seed)
    indices = rng.integers(0, len(labels), size=(samples, len(labels)))
    output: dict[str, Any] = {}
    predictions_by_method: dict[str, np.ndarray] = {}
    for method, details in report["method_details"].items():
        predictions = np.asarray(details["accepted"], dtype=bool)
        predictions_by_method[method] = predictions
        method_metrics: dict[str, Any] = {}
        for metric in ("precision", "recall", "f1", "false_accept_rate"):
            values = np.asarray(
                [metric_from_predictions(labels[index], predictions[index], metric) for index in indices]
            )
            method_metrics[metric] = {
                "low": float(np.quantile(values, 0.025)),
                "high": float(np.quantile(values, 0.975)),
            }
        output[method] = method_metrics

    baseline = predictions_by_method["B_top3_mean"]
    output["paired_f1_delta_vs_B"] = {}
    for method, predictions in predictions_by_method.items():
        if method == "B_top3_mean":
            continue
        deltas = np.asarray(
            [
                metric_from_predictions(labels[index], predictions[index], "f1")
                - metric_from_predictions(labels[index], baseline[index], "f1")
                for index in indices
            ]
        )
        output["paired_f1_delta_vs_B"][method] = {
            "mean": float(deltas.mean()),
            "low": float(np.quantile(deltas, 0.025)),
            "high": float(np.quantile(deltas, 0.975)),
        }
    return output


def serializable_report(report: dict[str, Any], usage: dict[str, Any]) -> dict[str, Any]:
    return {
        "dataset": "klue/klue:mrc",
        "sample_rows": len(report["features"]),
        "cluster": report["cluster"],
        "retrieval": report["retrieval"],
        "methods": compact_results(report),
        "bootstrap_95_ci": bootstrap_intervals(report),
        "embedding_usage": usage,
        "feature_extraction_ms_total": report["feature_extraction_ms_total"],
        "feature_extraction_ms_per_query": report["feature_extraction_ms_per_query"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    env_path = find_dotenv(usecwd=True)
    load_dotenv(env_path, override=True)
    documents, cases = load_dataset(args.dataset)
    chunks = chunks_from_texts(documents, chunk_size=600, overlap=150)
    cache_path = Path(env_path).parent / "agent" / ".uv-cache" / "similarity-benchmark" / "klue-mrc-1536.json"
    embedder = OpenAIEmbedder(
        model="text-embedding-3-small",
        dimensions=1536,
        cache_path=cache_path,
        batch_size=128,
    )
    corpus_vectors = embed_corpus(chunks, embedder)
    query_vectors = embed_queries(cases, embedder)
    clusters = select_clusters(
        corpus_vectors,
        max_k=12,
        min_cluster_size=10,
        min_silhouette=0.05,
        seed=42,
    )
    report = run_benchmark(
        chunks,
        corpus_vectors,
        cases,
        query_vectors,
        clusters=clusters,
        max_false_accept_rate=0.10,
        uncertain_band=0.10,
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = serializable_report(report, embedder.usage_summary())
    (args.output_dir / "results.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    plot_benchmark_report(report, output_dir=args.output_dir, show=False)
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
