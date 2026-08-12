from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path
from typing import Any

import matplotlib
import numpy as np
from dotenv import load_dotenv
from run_answerability_verifier import load_rows
from similarity_benchmark import (
    BM25Index,
    OpenAIEmbedder,
    chunks_from_texts,
    embed_corpus,
    normalize_rows,
)

matplotlib.use("Agg")
from matplotlib import pyplot as plt  # noqa: E402


def reciprocal_rank_fusion(
    dense_scores: np.ndarray,
    lexical_scores: np.ndarray,
    chunks: list[Any],
    *,
    top_k: int,
    pool_size: int = 50,
    rank_constant: int = 60,
) -> list[int]:
    fused: dict[int, float] = {}
    for scores in (dense_scores, lexical_scores):
        for rank, index in enumerate(np.argsort(-scores)[:pool_size], start=1):
            index = int(index)
            fused[index] = fused.get(index, 0.0) + 1.0 / (rank_constant + rank)
    selected: list[int] = []
    for index, _ in sorted(fused.items(), key=lambda item: (-item[1], item[0])):
        chunk = chunks[index]
        adjacent_duplicate = any(
            chunks[chosen].document_id == chunk.document_id
            and abs(chunks[chosen].chunk_index - chunk.chunk_index) <= 1
            for chosen in selected
        )
        if not adjacent_duplicate:
            selected.append(index)
        if len(selected) == top_k:
            break
    return selected


def build_hybrid_retrieval(
    rows: list[dict[str, Any]],
    chunks: list[Any],
    corpus_vectors: np.ndarray,
    query_vectors: np.ndarray,
    *,
    top_k: int,
) -> list[list[int]]:
    bm25 = BM25Index([chunk.text for chunk in chunks])
    return [
        reciprocal_rank_fusion(
            corpus_vectors @ query_vector,
            bm25.score(row["question"]),
            chunks,
            top_k=top_k,
        )
        for row, query_vector in zip(rows, query_vectors, strict=True)
    ]


def score_all_pairs(
    model: Any,
    tokenizer: Any,
    rows: list[dict[str, Any]],
    chunks: list[Any],
    retrieved: list[list[int]],
    *,
    device: Any,
    batch_size: int,
    max_length: int,
) -> tuple[np.ndarray, float]:
    import torch

    pairs = [
        (row["question"], chunks[index].text)
        for row, indices in zip(rows, retrieved, strict=True)
        for index in indices
    ]
    probabilities: list[float] = []
    started = time.perf_counter()
    model.eval()
    for offset in range(0, len(pairs), batch_size):
        batch = pairs[offset : offset + batch_size]
        encoded = tokenizer(
            [item[0] for item in batch],
            [item[1] for item in batch],
            padding=True,
            truncation=True,
            max_length=max_length,
            return_tensors="pt",
        )
        encoded.pop("token_type_ids", None)
        encoded = encoded.to(device)
        with torch.inference_mode(), torch.autocast(
            device_type=device.type,
            dtype=torch.bfloat16,
            enabled=device.type == "cuda" and torch.cuda.is_bf16_supported(),
        ):
            logits = model(**encoded).logits.float()
        probabilities.extend(torch.softmax(logits, dim=-1)[:, 1].cpu().tolist())
    if device.type == "cuda":
        torch.cuda.synchronize()
    matrix = np.asarray(probabilities, dtype=np.float64).reshape(len(rows), -1)
    return matrix, (time.perf_counter() - started) * 1_000


def wilson_upper(errors: int, total: int, *, z: float = 1.6448536269514722) -> float:
    if total == 0:
        return 1.0
    rate = errors / total
    denominator = 1.0 + z**2 / total
    center = rate + z**2 / (2 * total)
    spread = z * math.sqrt(rate * (1.0 - rate) / total + z**2 / (4 * total**2))
    return min(1.0, (center + spread) / denominator)


def choose_accept_threshold(
    labels: np.ndarray,
    scores: np.ndarray,
    *,
    max_false_accept_rate: float,
) -> float:
    negatives = ~labels
    candidates = sorted(set(scores.tolist()), reverse=True)
    valid: list[float] = []
    for threshold in candidates:
        false_accepts = int(np.sum((scores >= threshold) & negatives))
        if wilson_upper(false_accepts, int(negatives.sum())) <= max_false_accept_rate:
            valid.append(threshold)
    return min(valid) if valid else float(np.nextafter(scores.max(), math.inf))


def choose_reject_threshold(
    labels: np.ndarray,
    scores: np.ndarray,
    *,
    max_false_reject_rate: float,
) -> float:
    candidates = sorted(set(scores.tolist()))
    valid: list[float] = []
    for threshold in candidates:
        false_rejects = int(np.sum((scores <= threshold) & labels))
        if wilson_upper(false_rejects, int(labels.sum())) <= max_false_reject_rate:
            valid.append(threshold)
    return max(valid) if valid else float(np.nextafter(scores.min(), -math.inf))


def selective_metrics(
    labels: np.ndarray,
    scores: np.ndarray,
    *,
    reject_threshold: float,
    accept_threshold: float,
) -> dict[str, float | int]:
    accepted = scores >= accept_threshold
    rejected = scores <= reject_threshold
    fallback = ~(accepted | rejected)
    resolved = accepted | rejected
    local_correct = (accepted & labels) | (rejected & ~labels)
    false_accepts = int(np.sum(accepted & ~labels))
    false_rejects = int(np.sum(rejected & labels))
    return {
        "n": len(labels),
        "local_accept": int(accepted.sum()),
        "local_reject": int(rejected.sum()),
        "llm_fallback": int(fallback.sum()),
        "local_coverage": float(resolved.mean()),
        "llm_fallback_rate": float(fallback.mean()),
        "local_resolved_accuracy": float(local_correct.sum() / max(int(resolved.sum()), 1)),
        "local_accept_precision": float(np.sum(accepted & labels) / max(int(accepted.sum()), 1)),
        "false_accept_rate": false_accepts / max(int((~labels).sum()), 1),
        "false_reject_rate": false_rejects / max(int(labels.sum()), 1),
        "perfect_fallback_accuracy_ceiling": float((local_correct.sum() + fallback.sum()) / len(labels)),
    }


def retrieval_recall(
    rows: list[dict[str, Any]],
    retrieved: list[list[int]],
    chunks: list[Any],
    *,
    split: str,
    k: int,
) -> float:
    hits: list[bool] = []
    for row, indices in zip(rows, retrieved, strict=True):
        if row["benchmark_split"] != split or not row["answerable"]:
            continue
        hits.append(any(chunks[index].document_id == row["document_id"] for index in indices[:k]))
    return float(np.mean(hits)) if hits else 0.0


def estimate_llm_cost(
    rows: list[dict[str, Any]],
    retrieved: list[list[int]],
    chunks: list[Any],
    fallback: np.ndarray,
) -> dict[str, float | int]:
    characters = sum(
        len(row["question"]) + sum(len(chunks[index].text) for index in indices[:3])
        for row, indices, use_llm in zip(rows, retrieved, fallback, strict=True)
        if use_llm
    )
    estimated_input_tokens = math.ceil(characters / 2.5)
    calls = int(fallback.sum())
    estimated_output_tokens = calls * 25
    return {
        "calls": calls,
        "estimated_input_tokens": estimated_input_tokens,
        "estimated_output_tokens": estimated_output_tokens,
        "estimated_gpt_5_4_nano_cost_usd": estimated_input_tokens * 0.20 / 1_000_000
        + estimated_output_tokens * 1.25 / 1_000_000,
    }


def plot_pipeline(
    test_labels: np.ndarray,
    test_scores: np.ndarray,
    reject_threshold: float,
    accept_threshold: float,
    metrics: dict[str, float | int],
    output: Path,
) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    axes[0].hist(test_scores[~test_labels], bins=20, alpha=0.65, label="unanswerable", color="#ef6c73")
    axes[0].hist(test_scores[test_labels], bins=20, alpha=0.65, label="answerable", color="#53d68b")
    axes[0].axvline(reject_threshold, color="#7b55d9", linestyle="--", label="local reject")
    axes[0].axvline(accept_threshold, color="#2457d6", linestyle="--", label="local accept")
    axes[0].set(title="Selective verifier bands", xlabel="answerability score", ylabel="count")
    axes[0].legend()
    names = ["local_coverage", "llm_fallback_rate", "local_resolved_accuracy", "false_accept_rate"]
    axes[1].bar(names, [float(metrics[name]) for name in names], color=["#4777e6", "#edb22f", "#45b46f", "#e55353"])
    axes[1].axhline(0.10, color="#e55353", linestyle="--", linewidth=1)
    axes[1].tick_params(axis="x", rotation=18)
    axes[1].set(title="Frozen-test selective policy", ylim=(0, 1), ylabel="rate")
    fig.tight_layout()
    fig.savefig(output, dpi=160, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--candidate-k", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=24)
    parser.add_argument("--max-length", type=int, default=384)
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
    retrieved = build_hybrid_retrieval(rows, chunks, corpus_vectors, query_vectors, top_k=args.candidate_k)

    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = AutoTokenizer.from_pretrained(args.model_dir, local_files_only=True)
    model = AutoModelForSequenceClassification.from_pretrained(args.model_dir, local_files_only=True).to(device)
    score_matrix, latency_ms = score_all_pairs(
        model,
        tokenizer,
        rows,
        chunks,
        retrieved,
        device=device,
        batch_size=args.batch_size,
        max_length=args.max_length,
    )
    validation_mask = np.asarray([row["benchmark_split"] == "validation" for row in rows])
    test_mask = np.asarray([row["benchmark_split"] == "test" for row in rows])
    labels = np.asarray([bool(row["answerable"]) for row in rows])
    validation_scores = score_matrix[validation_mask].max(axis=1)
    test_scores = score_matrix[test_mask].max(axis=1)
    validation_labels = labels[validation_mask]
    test_labels = labels[test_mask]
    accept_threshold = choose_accept_threshold(
        validation_labels, validation_scores, max_false_accept_rate=0.10
    )
    reject_threshold = choose_reject_threshold(
        validation_labels, validation_scores, max_false_reject_rate=0.10
    )
    if reject_threshold >= accept_threshold:
        reject_threshold = float(np.nextafter(accept_threshold, -math.inf))
    validation_metrics = selective_metrics(
        validation_labels,
        validation_scores,
        reject_threshold=reject_threshold,
        accept_threshold=accept_threshold,
    )
    test_metrics = selective_metrics(
        test_labels,
        test_scores,
        reject_threshold=reject_threshold,
        accept_threshold=accept_threshold,
    )
    test_rows = [row for row in rows if row["benchmark_split"] == "test"]
    test_retrieved = [indices for row, indices in zip(rows, retrieved, strict=True) if row["benchmark_split"] == "test"]
    fallback = (test_scores > reject_threshold) & (test_scores < accept_threshold)
    recall_by_k = {
        str(k): retrieval_recall(rows, retrieved, chunks, split="test", k=k)
        for k in (3, 5, 10)
        if k <= args.candidate_k
    }
    result = {
        "dataset": "klue/klue:mrc",
        "retrieval": {"method": "dense_bm25_rrf", "candidate_k": args.candidate_k, "recall_by_k": recall_by_k},
        "threshold_policy": {
            "confidence": 0.90,
            "max_validation_false_accept_rate_upper_bound": 0.10,
            "max_validation_false_reject_rate_upper_bound": 0.10,
            "reject_threshold": reject_threshold,
            "accept_threshold": accept_threshold,
        },
        "validation": validation_metrics,
        "test": test_metrics,
        "llm_fallback_estimate": estimate_llm_cost(test_rows, test_retrieved, chunks, fallback),
        "latency": {
            "all_650_queries_ms": latency_ms,
            "test_estimated_ms_per_query": latency_ms / len(rows),
        },
        "embedding_usage_this_run": embedder.usage_summary(),
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "hybrid_pipeline_results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    plot_pipeline(
        test_labels,
        test_scores,
        reject_threshold,
        accept_threshold,
        test_metrics,
        args.output_dir / "hybrid_pipeline_results.png",
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
