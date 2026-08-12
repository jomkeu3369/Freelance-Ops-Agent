from __future__ import annotations

import argparse
import json
import random
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import matplotlib
import numpy as np
from dotenv import load_dotenv
from similarity_benchmark import (
    OpenAIEmbedder,
    _deduplicated_top_indices,
    choose_threshold,
    chunks_from_texts,
    classification_metrics,
    embed_corpus,
    normalize_rows,
)

matplotlib.use("Agg")
from matplotlib import pyplot as plt  # noqa: E402


@dataclass(frozen=True, slots=True)
class PairExample:
    case_id: str
    question: str
    chunk: str
    label: bool


def load_rows(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def answer_texts(row: dict[str, Any]) -> tuple[str, ...]:
    if not row["answerable"]:
        return ()
    return tuple(text.strip() for text in row["answers"].get("text", []) if text.strip())


def chunk_contains_answer(chunk: str, answers: tuple[str, ...]) -> bool:
    compact_chunk = "".join(chunk.split()).casefold()
    return any("".join(answer.split()).casefold() in compact_chunk for answer in answers)


def retrieve_indices(
    corpus_vectors: np.ndarray,
    query_vectors: np.ndarray,
    chunks: list[Any],
    *,
    top_k: int = 3,
) -> list[list[int]]:
    return [
        _deduplicated_top_indices(corpus_vectors @ query_vector, chunks, k=top_k)
        for query_vector in query_vectors
    ]


def build_training_pairs(
    rows: list[dict[str, Any]],
    chunks: list[Any],
    retrieved: list[list[int]],
    *,
    seed: int = 42,
) -> list[PairExample]:
    rng = random.Random(seed)
    chunks_by_document: dict[str, list[int]] = {}
    for index, chunk in enumerate(chunks):
        chunks_by_document.setdefault(chunk.document_id, []).append(index)

    positives: list[PairExample] = []
    negatives: list[PairExample] = []
    for row, retrieved_indices_for_case in zip(rows, retrieved, strict=True):
        if row["benchmark_split"] != "train":
            continue
        answers = answer_texts(row)
        candidate_indices = list(
            dict.fromkeys(chunks_by_document[row["document_id"]] + retrieved_indices_for_case)
        )
        case_negatives: list[PairExample] = []
        for index in candidate_indices:
            chunk = chunks[index]
            label = bool(
                row["answerable"]
                and chunk.document_id == row["document_id"]
                and chunk_contains_answer(chunk.text, answers)
            )
            example = PairExample(row["case_id"], row["question"], chunk.text, label)
            if label:
                positives.append(example)
            else:
                case_negatives.append(example)
        rng.shuffle(case_negatives)
        negatives.extend(case_negatives[:4])

    if not positives:
        raise ValueError("positive verifier 학습 pair가 없습니다.")
    rng.shuffle(negatives)
    negatives = negatives[: min(len(negatives), len(positives) * 3)]
    pairs = positives * 3 + negatives
    rng.shuffle(pairs)
    return pairs


def score_cases(
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
    flat_pairs = [(row["question"], chunks[index].text) for row, indices in selected for index in indices]
    started = time.perf_counter()
    probabilities: list[float] = []
    model.eval()
    for offset in range(0, len(flat_pairs), batch_size):
        batch = flat_pairs[offset : offset + batch_size]
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
    elapsed_ms = (time.perf_counter() - started) * 1_000
    matrix = np.asarray(probabilities, dtype=np.float64).reshape(len(selected), -1)
    scores = matrix.max(axis=1)
    labels = np.asarray([bool(row["answerable"]) for row, _ in selected], dtype=bool)
    return labels, scores, elapsed_ms


def train_verifier(
    pairs: list[PairExample],
    *,
    model_id: str,
    device_name: str,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    max_length: int,
    seed: int,
) -> tuple[Any, Any, dict[str, Any]]:
    import torch
    from torch.optim import AdamW
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    torch.manual_seed(seed)
    random.seed(seed)
    np.random.seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    device = torch.device("cuda" if device_name == "auto" and torch.cuda.is_available() else device_name)
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = AutoModelForSequenceClassification.from_pretrained(model_id, num_labels=2).to(device)
    optimizer = AdamW(model.parameters(), lr=learning_rate)
    use_bf16 = device.type == "cuda" and torch.cuda.is_bf16_supported()
    epoch_losses: list[float] = []
    started = time.perf_counter()
    for epoch in range(epochs):
        model.train()
        order = torch.randperm(len(pairs), generator=torch.Generator().manual_seed(seed + epoch)).tolist()
        losses: list[float] = []
        for offset in range(0, len(order), batch_size):
            batch = [pairs[index] for index in order[offset : offset + batch_size]]
            encoded = tokenizer(
                [item.question for item in batch],
                [item.chunk for item in batch],
                padding=True,
                truncation=True,
                max_length=max_length,
                return_tensors="pt",
            )
            encoded.pop("token_type_ids", None)
            encoded = encoded.to(device)
            labels = torch.tensor([int(item.label) for item in batch], dtype=torch.long, device=device)
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=use_bf16):
                loss = model(**encoded, labels=labels).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        epoch_losses.append(float(np.mean(losses)))
    if device.type == "cuda":
        torch.cuda.synchronize()
    metadata = {
        "model_id": model_id,
        "device": str(device),
        "device_name": torch.cuda.get_device_name(0) if device.type == "cuda" else "CPU",
        "training_pairs": len(pairs),
        "label_counts": dict(Counter(str(int(pair.label)) for pair in pairs)),
        "epochs": epochs,
        "batch_size": batch_size,
        "learning_rate": learning_rate,
        "max_length": max_length,
        "epoch_losses": epoch_losses,
        "training_seconds": time.perf_counter() - started,
    }
    return model, tokenizer, metadata


def plot_results(
    labels: np.ndarray,
    scores: np.ndarray,
    threshold: float,
    metrics: dict[str, float],
    output: Path,
) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    axes[0].hist(scores[~labels], bins=20, alpha=0.65, label="unanswerable", color="#ef6c73")
    axes[0].hist(scores[labels], bins=20, alpha=0.65, label="answerable", color="#53d68b")
    axes[0].axvline(threshold, color="#2457d6", linestyle="--", label=f"threshold={threshold:.3f}")
    axes[0].set(title="Verifier score separation", xlabel="answerability probability", ylabel="count")
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
    parser.add_argument("--model-id", default="klue/roberta-small")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
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
    pairs = build_training_pairs(rows, chunks, retrieved)
    model, tokenizer, training = train_verifier(
        pairs,
        model_id=args.model_id,
        device_name=args.device,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        max_length=args.max_length,
        seed=42,
    )
    import torch

    device = next(model.parameters()).device
    validation_labels, validation_scores, validation_ms = score_cases(
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
    test_labels, test_scores, test_ms = score_cases(
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
    metrics = classification_metrics(test_labels, test_scores, threshold)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    model_dir = Path(__file__).parents[2] / ".uv-cache" / "similarity-benchmark" / "klue-answerability-verifier"
    model.save_pretrained(model_dir)
    tokenizer.save_pretrained(model_dir)
    output = {
        "dataset": "klue/klue:mrc",
        "retrieval_top_k": 3,
        "training": training,
        "threshold": threshold,
        "validation": classification_metrics(validation_labels, validation_scores, threshold),
        "test": metrics,
        "latency": {
            "validation_ms_total": validation_ms,
            "test_ms_total": test_ms,
            "test_ms_per_query": test_ms / len(test_labels),
        },
        "embedding_usage_this_run": embedder.usage_summary(),
        "model_cache": str(model_dir),
    }
    (args.output_dir / "verifier_results.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    plot_results(test_labels, test_scores, threshold, metrics, args.output_dir / "verifier_results.png")
    print(json.dumps(output, ensure_ascii=False, indent=2))
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
