from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from run_answerability_verifier import (
    PairExample,
    load_rows,
    plot_results,
    retrieve_indices,
    score_cases,
    train_verifier,
)
from similarity_benchmark import (
    OpenAIEmbedder,
    choose_threshold,
    chunks_from_texts,
    classification_metrics,
    embed_corpus,
    normalize_rows,
    tokenize,
)


def windows(text: str, *, size: int = 600, stride: int = 450) -> list[str]:
    if len(text) <= size:
        return [text]
    starts = list(range(0, max(len(text) - size + 1, 1), stride))
    if starts[-1] + size < len(text):
        starts.append(len(text) - size)
    return [text[start : start + size] for start in starts]


def lexical_best_window(question: str, context: str) -> str:
    question_tokens = set(tokenize(question))
    candidates = windows(context)
    return max(candidates, key=lambda candidate: len(question_tokens.intersection(tokenize(candidate))))


def answer_window(context: str, answer_start: int, answer_text: str, *, size: int = 600) -> str:
    midpoint = answer_start + len(answer_text) // 2
    start = max(0, min(midpoint - size // 2, len(context) - size))
    return context[start : start + size]


def build_full_training_pairs(
    source_rows: list[dict[str, Any]],
    *,
    excluded_case_ids: set[str],
    seed: int = 42,
) -> list[PairExample]:
    positives: list[PairExample] = []
    negatives: list[PairExample] = []
    for row in source_rows:
        case_id = str(row["guid"])
        if case_id in excluded_case_ids:
            continue
        question = str(row["question"])
        context = str(row["context"])
        if bool(row["is_impossible"]):
            negatives.append(PairExample(case_id, question, lexical_best_window(question, context), False))
            continue
        texts = [text.strip() for text in row["answers"]["text"] if text.strip()]
        starts = [int(value) for value in row["answers"]["answer_start"]]
        if not texts or not starts:
            continue
        positive_chunk = answer_window(context, starts[0], texts[0])
        positives.append(PairExample(case_id, question, positive_chunk, True))
        other_chunks = [candidate for candidate in windows(context) if texts[0] not in candidate]
        if other_chunks:
            negatives.append(
                PairExample(
                    case_id,
                    question,
                    max(
                        other_chunks,
                        key=lambda candidate: len(set(tokenize(question)).intersection(tokenize(candidate))),
                    ),
                    False,
                )
            )
    rng = random.Random(seed)
    rng.shuffle(positives)
    rng.shuffle(negatives)
    per_label = min(len(positives), len(negatives))
    pairs = positives[:per_label] + negatives[:per_label]
    rng.shuffle(pairs)
    return pairs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model-id", default="klue/roberta-small")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=24)
    parser.add_argument("--max-length", type=int, default=384)
    args = parser.parse_args()
    from datasets import load_dataset

    load_dotenv(Path(__file__).parents[3] / ".env", override=True)
    benchmark_rows = load_rows(args.dataset)
    documents = {row["document_id"]: row["context"] for row in benchmark_rows}
    chunks = chunks_from_texts(documents, chunk_size=600, overlap=150)
    embedder = OpenAIEmbedder(
        model="text-embedding-3-small",
        dimensions=1536,
        cache_path=Path(__file__).parents[2] / ".uv-cache" / "similarity-benchmark" / "klue-mrc-1536.json",
        batch_size=128,
    )
    corpus_vectors = embed_corpus(chunks, embedder)
    query_vectors = normalize_rows(embedder.embed_documents([row["question"] for row in benchmark_rows]))
    retrieved = retrieve_indices(corpus_vectors, query_vectors, chunks)
    source = load_dataset("klue/klue", "mrc", split="train")
    excluded = {
        row["case_id"]
        for row in benchmark_rows
        if row["benchmark_split"] == "validation"
    }
    pairs = build_full_training_pairs(list(source), excluded_case_ids=excluded)
    model, tokenizer, training = train_verifier(
        pairs,
        model_id=args.model_id,
        device_name=args.device,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=2e-5,
        max_length=args.max_length,
        seed=42,
    )
    device = next(model.parameters()).device
    validation_labels, validation_scores, validation_ms = score_cases(
        model,
        tokenizer,
        benchmark_rows,
        chunks,
        retrieved,
        split="validation",
        device=device,
        batch_size=args.batch_size,
        max_length=args.max_length,
    )
    strict_threshold = choose_threshold(validation_labels, validation_scores, max_false_accept_rate=0.10)
    utility_threshold = choose_threshold(validation_labels, validation_scores, max_false_accept_rate=1.0)
    test_labels, test_scores, test_ms = score_cases(
        model,
        tokenizer,
        benchmark_rows,
        chunks,
        retrieved,
        split="test",
        device=device,
        batch_size=args.batch_size,
        max_length=args.max_length,
    )
    strict_metrics = classification_metrics(test_labels, test_scores, strict_threshold)
    utility_metrics = classification_metrics(test_labels, test_scores, utility_threshold)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    model_dir = Path(__file__).parents[2] / ".uv-cache" / "similarity-benchmark" / "klue-full-verifier"
    model.save_pretrained(model_dir)
    tokenizer.save_pretrained(model_dir)
    result = {
        "dataset": "klue/klue:mrc",
        "training": training,
        "excluded_calibration_cases": len(excluded),
        "strict_threshold": strict_threshold,
        "strict_validation": classification_metrics(validation_labels, validation_scores, strict_threshold),
        "strict_test": strict_metrics,
        "utility_threshold": utility_threshold,
        "utility_validation": classification_metrics(validation_labels, validation_scores, utility_threshold),
        "utility_test": utility_metrics,
        "latency": {
            "validation_ms_total": validation_ms,
            "test_ms_total": test_ms,
            "test_ms_per_query": test_ms / len(test_labels),
        },
        "embedding_usage_this_run": embedder.usage_summary(),
        "model_cache": str(model_dir),
    }
    (args.output_dir / "full_verifier_results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    plot_results(
        test_labels,
        test_scores,
        strict_threshold,
        strict_metrics,
        args.output_dir / "full_verifier_results.png",
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
