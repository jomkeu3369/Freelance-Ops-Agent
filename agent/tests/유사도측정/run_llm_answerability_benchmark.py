from __future__ import annotations

import argparse
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field
from run_answerability_verifier import load_rows, retrieve_indices
from similarity_benchmark import (
    OpenAIEmbedder,
    chunks_from_texts,
    classification_metrics,
    embed_corpus,
    normalize_rows,
)

SYSTEM_PROMPT = """당신은 검색 근거 충분성 판정기다.
질문에 답하는 데 필요한 사실이 제공된 문단 안에 명시되어 있을 때만 answerable=true로 판정한다.
주제가 비슷하거나 관련 단어만 등장하는 것은 충분하지 않다.
외부 지식, 상식, 추측을 사용하지 않는다. 문단끼리 결합해 답할 수 있으면 true다.
false일 때 evidence_chunk는 null이어야 한다."""


class Verdict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answerable: bool
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_chunk: int | None


def build_user_input(question: str, passages: list[str]) -> str:
    payload = {
        "question": question,
        "passages": [{"chunk": index + 1, "text": text} for index, text in enumerate(passages)],
    }
    return json.dumps(payload, ensure_ascii=False)


def evaluate_case(client: OpenAI, model: str, case_id: str, question: str, passages: list[str]) -> dict[str, Any]:
    started = time.perf_counter()
    response = client.responses.create(
        model=model,
        reasoning={"effort": "none"},
        input=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_input(question, passages)},
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "retrieval_answerability",
                "strict": True,
                "schema": Verdict.model_json_schema(),
            }
        },
    )
    verdict = Verdict.model_validate_json(response.output_text)
    usage = response.usage
    return {
        "case_id": case_id,
        **verdict.model_dump(),
        "input_tokens": int(getattr(usage, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(usage, "output_tokens", 0) or 0),
        "latency_ms": (time.perf_counter() - started) * 1_000,
    }


def load_checkpoint(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    return {
        row["case_id"]: row
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
        for row in [json.loads(line)]
    }


def append_checkpoint(path: Path, row: dict[str, Any], lock: threading.Lock) -> None:
    with lock, path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model", default="gpt-5.4-nano")
    parser.add_argument("--workers", type=int, default=10)
    args = parser.parse_args()
    load_dotenv(Path(__file__).parents[3] / "experiments" / ".env", override=True)
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
    test_items = [
        (row, [chunks[index].text for index in indices])
        for row, indices in zip(rows, retrieved, strict=True)
        if row["benchmark_split"] == "test"
    ]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = args.output_dir / "llm_verdicts.jsonl"
    completed = load_checkpoint(checkpoint_path)
    client = OpenAI(timeout=60.0, max_retries=3)
    lock = threading.Lock()
    pending = [(row, passages) for row, passages in test_items if row["case_id"] not in completed]
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(
                evaluate_case,
                client,
                args.model,
                row["case_id"],
                row["question"],
                passages,
            ): row["case_id"]
            for row, passages in pending
        }
        for future in as_completed(futures):
            result = future.result()
            completed[result["case_id"]] = result
            append_checkpoint(checkpoint_path, result, lock)
            if len(completed) % 20 == 0:
                print(f"completed={len(completed)}/{len(test_items)}", flush=True)

    ordered = [completed[row["case_id"]] for row, _ in test_items]
    labels = np.asarray([bool(row["answerable"]) for row, _ in test_items], dtype=bool)
    scores = np.asarray([float(result["answerable"]) for result in ordered])
    metrics = classification_metrics(labels, scores, 0.5)
    input_tokens = sum(result["input_tokens"] for result in ordered)
    output_tokens = sum(result["output_tokens"] for result in ordered)
    result = {
        "dataset": "klue/klue:mrc",
        "model": args.model,
        "retrieval_top_k": 3,
        "test": metrics,
        "calls": len(ordered),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "estimated_cost_usd": input_tokens * 0.20 / 1_000_000 + output_tokens * 1.25 / 1_000_000,
        "latency_ms": {
            "mean": float(np.mean([result["latency_ms"] for result in ordered])),
            "p50": float(np.median([result["latency_ms"] for result in ordered])),
            "p95": float(np.quantile([result["latency_ms"] for result in ordered], 0.95)),
        },
        "embedding_usage_this_run": embedder.usage_summary(),
    }
    (args.output_dir / "llm_results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
