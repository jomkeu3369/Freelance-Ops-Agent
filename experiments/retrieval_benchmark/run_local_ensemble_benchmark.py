from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import matplotlib
import numpy as np
from dotenv import load_dotenv

from run_answerability_verifier import load_rows
from run_hybrid_pipeline_benchmark import (
    build_hybrid_retrieval,
    choose_accept_threshold,
    choose_reject_threshold,
    estimate_llm_cost,
    retrieval_recall,
    score_all_pairs,
)
from run_qa_reader_benchmark import score_reader
from similarity_benchmark import OpenAIEmbedder, chunks_from_texts, embed_corpus, normalize_rows

matplotlib.use("Agg")
from matplotlib import pyplot as plt  # noqa: E402


def ensemble_decisions(
    verifier_scores: np.ndarray,
    reader_scores: np.ndarray,
    *,
    verifier_reject: float,
    verifier_accept: float,
    reader_reject: float,
    reader_accept: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    accepted = (verifier_scores >= verifier_accept) & (reader_scores >= reader_accept)
    rejected = (verifier_scores <= verifier_reject) & (reader_scores <= reader_reject)
    fallback = ~(accepted | rejected)
    return accepted, rejected, fallback


def decision_metrics(
    labels: np.ndarray,
    accepted: np.ndarray,
    rejected: np.ndarray,
    fallback: np.ndarray,
) -> dict[str, float | int]:
    resolved = accepted | rejected
    correct = (accepted & labels) | (rejected & ~labels)
    false_accepts = int(np.sum(accepted & ~labels))
    false_rejects = int(np.sum(rejected & labels))
    return {
        "n": len(labels),
        "local_accept": int(accepted.sum()),
        "local_reject": int(rejected.sum()),
        "llm_fallback": int(fallback.sum()),
        "local_coverage": float(resolved.mean()),
        "llm_fallback_rate": float(fallback.mean()),
        "local_resolved_accuracy": float(correct.sum() / max(int(resolved.sum()), 1)),
        "local_accept_precision": float(np.sum(accepted & labels) / max(int(accepted.sum()), 1)),
        "false_accept_rate": false_accepts / max(int((~labels).sum()), 1),
        "false_reject_rate": false_rejects / max(int(labels.sum()), 1),
        "perfect_fallback_accuracy_ceiling": float((correct.sum() + fallback.sum()) / len(labels)),
    }


def plot_ensemble(metrics: dict[str, float | int], output: Path) -> None:
    names = [
        "local_coverage",
        "llm_fallback_rate",
        "local_resolved_accuracy",
        "local_accept_precision",
        "false_accept_rate",
        "false_reject_rate",
    ]
    fig, ax = plt.subplots(figsize=(11, 5))
    colors = ["#4777e6", "#edb22f", "#45b46f", "#52a9d8", "#e55353", "#8b5bd9"]
    ax.bar(names, [float(metrics[name]) for name in names], color=colors)
    ax.axhline(0.10, color="#e55353", linestyle="--", linewidth=1)
    ax.tick_params(axis="x", rotation=18)
    ax.set(title="Cross-encoder + QA reader selective ensemble", ylim=(0, 1), ylabel="rate")
    fig.tight_layout()
    fig.savefig(output, dpi=160, bbox_inches="tight")
    plt.close(fig)


def split_scores(values: np.ndarray, rows: list[dict[str, Any]], split: str) -> np.ndarray:
    return values[np.asarray([row["benchmark_split"] == split for row in rows])]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--verifier-model-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--reader-model-id", default="ainize/klue-bert-base-mrc")
    parser.add_argument("--candidate-k", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=24)
    args = parser.parse_args()
    load_dotenv(Path(__file__).parents[3] / ".env", override=True)
    rows = load_rows(args.dataset)
    documents = {row["document_id"]: row["context"] for row in rows}
    chunks = chunks_from_texts(documents, chunk_size=600, overlap=150)
    embedder = OpenAIEmbedder(
        model="text-embedding-3-small",
        dimensions=1536,
        cache_path=Path(__file__).parents[2] / ".uv-cache" / "similarity-benchmark" / "klue-mrc-1536.json",
        batch_size=128,
    )
    corpus_vectors = embed_corpus(chunks, embedder)
    query_vectors = normalize_rows(embedder.embed_documents([row["question"] for row in rows]))
    retrieved = build_hybrid_retrieval(
        rows, chunks, corpus_vectors, query_vectors, top_k=args.candidate_k
    )

    import torch
    from transformers import (
        AutoModelForQuestionAnswering,
        AutoModelForSequenceClassification,
        AutoTokenizer,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    verifier_tokenizer = AutoTokenizer.from_pretrained(
        args.verifier_model_dir, local_files_only=True
    )
    verifier = AutoModelForSequenceClassification.from_pretrained(
        args.verifier_model_dir, local_files_only=True
    ).to(device)
    verifier_matrix, verifier_ms = score_all_pairs(
        verifier,
        verifier_tokenizer,
        rows,
        chunks,
        retrieved,
        device=device,
        batch_size=args.batch_size,
        max_length=384,
    )
    verifier_scores = verifier_matrix.max(axis=1)
    del verifier
    torch.cuda.empty_cache()

    reader_tokenizer = AutoTokenizer.from_pretrained(args.reader_model_id, local_files_only=True)
    reader = AutoModelForQuestionAnswering.from_pretrained(
        args.reader_model_id, local_files_only=True
    ).to(device)
    validation_labels, validation_reader_scores, validation_reader_ms = score_reader(
        reader,
        reader_tokenizer,
        rows,
        chunks,
        retrieved,
        split="validation",
        device=device,
        batch_size=args.batch_size,
        max_length=512,
    )
    test_labels, test_reader_scores, test_reader_ms = score_reader(
        reader,
        reader_tokenizer,
        rows,
        chunks,
        retrieved,
        split="test",
        device=device,
        batch_size=args.batch_size,
        max_length=512,
    )
    validation_verifier_scores = split_scores(verifier_scores, rows, "validation")
    test_verifier_scores = split_scores(verifier_scores, rows, "test")
    thresholds = {
        "verifier_accept": choose_accept_threshold(
            validation_labels, validation_verifier_scores, max_false_accept_rate=0.10
        ),
        "verifier_reject": choose_reject_threshold(
            validation_labels, validation_verifier_scores, max_false_reject_rate=0.10
        ),
        "reader_accept": choose_accept_threshold(
            validation_labels, validation_reader_scores, max_false_accept_rate=0.10
        ),
        "reader_reject": choose_reject_threshold(
            validation_labels, validation_reader_scores, max_false_reject_rate=0.10
        ),
    }
    validation_decisions = ensemble_decisions(
        validation_verifier_scores, validation_reader_scores, **thresholds
    )
    test_decisions = ensemble_decisions(test_verifier_scores, test_reader_scores, **thresholds)
    validation_metrics = decision_metrics(validation_labels, *validation_decisions)
    test_metrics = decision_metrics(test_labels, *test_decisions)
    test_rows = [row for row in rows if row["benchmark_split"] == "test"]
    test_retrieved = [
        indices
        for row, indices in zip(rows, retrieved, strict=True)
        if row["benchmark_split"] == "test"
    ]
    result = {
        "dataset": "klue/klue:mrc",
        "retrieval": {
            "method": "dense_bm25_rrf",
            "candidate_k": args.candidate_k,
            "recall_at_k": retrieval_recall(
                rows, retrieved, chunks, split="test", k=args.candidate_k
            ),
        },
        "models": {
            "verifier": str(args.verifier_model_dir),
            "reader": args.reader_model_id,
        },
        "thresholds": thresholds,
        "validation": validation_metrics,
        "test": test_metrics,
        "llm_fallback_estimate": estimate_llm_cost(
            test_rows, test_retrieved, chunks, test_decisions[2]
        ),
        "latency": {
            "verifier_all_650_ms": verifier_ms,
            "reader_validation_ms": validation_reader_ms,
            "reader_test_ms": test_reader_ms,
            "test_estimated_ms_per_query": verifier_ms / len(rows)
            + test_reader_ms / len(test_labels),
        },
        "embedding_usage_this_run": embedder.usage_summary(),
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "local_ensemble_results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    plot_ensemble(test_metrics, args.output_dir / "local_ensemble_results.png")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
