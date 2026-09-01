from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

import matplotlib
import numpy as np
from dotenv import load_dotenv

from run_answerability_verifier import load_rows, retrieve_indices
from similarity_benchmark import (
    OpenAIEmbedder,
    choose_threshold,
    chunks_from_texts,
    classification_metrics,
    embed_corpus,
    normalize_rows,
)

matplotlib.use("Agg")
from matplotlib import pyplot as plt  # noqa: E402


def best_span_margin(
    start_logits: np.ndarray,
    end_logits: np.ndarray,
    context_positions: list[int],
    *,
    null_position: int = 0,
    max_answer_tokens: int = 30,
) -> float:
    null_score = float(start_logits[null_position] + end_logits[null_position])
    best_score = -float("inf")
    for start in context_positions:
        end_limit = min(start + max_answer_tokens, len(end_logits))
        valid_ends = [position for position in context_positions if start <= position < end_limit]
        if valid_ends:
            best_score = max(best_score, float(start_logits[start] + np.max(end_logits[valid_ends])))
    return best_score - null_score


def score_reader(
    model: Any,
    tokenizer: Any,
    rows: list[dict[str, Any]],
    chunks: list[Any],
    retrieved: list[list[int]],
    *,
    split: str,
    device: Any,
    batch_size: int,
    max_length: int,
) -> tuple[np.ndarray, np.ndarray, float]:
    import torch

    selected = [(row, indices) for row, indices in zip(rows, retrieved, strict=True) if row["benchmark_split"] == split]
    pairs = [(row["question"], chunks[index].text) for row, indices in selected for index in indices]
    margins: list[float] = []
    started = time.perf_counter()
    model.eval()
    for offset in range(0, len(pairs), batch_size):
        batch = pairs[offset : offset + batch_size]
        encoded = tokenizer(
            [item[1] for item in batch],
            [item[0] for item in batch],
            padding=True,
            truncation=True,
            max_length=max_length,
            return_tensors="pt",
        )
        sequence_ids = [encoded.sequence_ids(index) for index in range(len(batch))]
        device_inputs = encoded.to(device)
        with torch.inference_mode(), torch.autocast(
            device_type=device.type,
            dtype=torch.bfloat16,
            enabled=device.type == "cuda" and torch.cuda.is_bf16_supported(),
        ):
            output = model(**device_inputs)
        starts = output.start_logits.float().cpu().numpy()
        ends = output.end_logits.float().cpu().numpy()
        for index, ids in enumerate(sequence_ids):
            context_positions = [position for position, sequence_id in enumerate(ids) if sequence_id == 0]
            margins.append(best_span_margin(starts[index], ends[index], context_positions))
    if device.type == "cuda":
        torch.cuda.synchronize()
    elapsed_ms = (time.perf_counter() - started) * 1_000
    case_scores = np.asarray(margins, dtype=np.float64).reshape(len(selected), -1).max(axis=1)
    labels = np.asarray([bool(row["answerable"]) for row, _ in selected], dtype=bool)
    return labels, case_scores, elapsed_ms


def plot_reader(
    labels: np.ndarray,
    scores: np.ndarray,
    threshold: float,
    metrics: dict[str, float],
    output: Path,
) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    axes[0].hist(scores[~labels], bins=20, alpha=0.65, label="unanswerable", color="#ef6c73")
    axes[0].hist(scores[labels], bins=20, alpha=0.65, label="answerable", color="#53d68b")
    axes[0].axvline(threshold, color="#2457d6", linestyle="--", label=f"threshold={threshold:.2f}")
    axes[0].set(title="QA reader: best span minus null", xlabel="logit margin", ylabel="count")
    axes[0].legend()
    names = ["precision", "recall", "f1", "false_accept_rate"]
    axes[1].bar(names, [metrics[name] for name in names], color=["#4777e6", "#45b46f", "#ed7d31", "#e55353"])
    axes[1].axhline(0.10, color="#e55353", linestyle="--", linewidth=1)
    axes[1].set(title="Frozen-test decision quality", ylim=(0, 1), ylabel="score")
    fig.tight_layout()
    fig.savefig(output, dpi=160, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model-id", default="ainize/klue-bert-base-mrc")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--batch-size", type=int, default=24)
    parser.add_argument("--max-length", type=int, default=512)
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
    retrieved = retrieve_indices(corpus_vectors, query_vectors, chunks)

    import torch
    from transformers import AutoModelForQuestionAnswering, AutoTokenizer

    device_name = "cuda" if args.device == "auto" and torch.cuda.is_available() else args.device
    device = torch.device(device_name)
    tokenizer = AutoTokenizer.from_pretrained(args.model_id)
    model = AutoModelForQuestionAnswering.from_pretrained(args.model_id).to(device)
    validation_labels, validation_scores, validation_ms = score_reader(
        model,
        tokenizer,
        rows,
        chunks,
        retrieved,
        split="validation",
        device=device,
        batch_size=args.batch_size,
        max_length=args.max_length,
    )
    threshold = choose_threshold(validation_labels, validation_scores, max_false_accept_rate=0.10)
    utility_threshold = choose_threshold(validation_labels, validation_scores, max_false_accept_rate=1.0)
    test_labels, test_scores, test_ms = score_reader(
        model,
        tokenizer,
        rows,
        chunks,
        retrieved,
        split="test",
        device=device,
        batch_size=args.batch_size,
        max_length=args.max_length,
    )
    validation_metrics = classification_metrics(validation_labels, validation_scores, threshold)
    test_metrics = classification_metrics(test_labels, test_scores, threshold)
    utility_validation_metrics = classification_metrics(
        validation_labels, validation_scores, utility_threshold
    )
    utility_test_metrics = classification_metrics(test_labels, test_scores, utility_threshold)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    result = {
        "dataset": "klue/klue:mrc",
        "model_id": args.model_id,
        "device": str(device),
        "retrieval_top_k": 3,
        "threshold": threshold,
        "validation": validation_metrics,
        "test": test_metrics,
        "utility_threshold": utility_threshold,
        "utility_validation": utility_validation_metrics,
        "utility_test": utility_test_metrics,
        "latency": {
            "validation_ms_total": validation_ms,
            "test_ms_total": test_ms,
            "test_ms_per_query": test_ms / len(test_labels),
        },
        "embedding_usage_this_run": embedder.usage_summary(),
    }
    (args.output_dir / "qa_reader_results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    plot_reader(test_labels, test_scores, threshold, test_metrics, args.output_dir / "qa_reader_results.png")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
