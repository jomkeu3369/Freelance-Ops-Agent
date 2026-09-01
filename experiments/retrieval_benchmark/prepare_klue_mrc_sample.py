from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import random
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import httpx

DATASET_ID = "klue/klue"
CONFIG = "mrc"
VIEWER_URL = "https://datasets-server.huggingface.co/rows"
SEED = 20260812


async def fetch_page(client: httpx.AsyncClient, split: str, offset: int) -> list[dict[str, Any]]:
    response = await client.get(
        VIEWER_URL,
        params={
            "dataset": DATASET_ID,
            "config": CONFIG,
            "split": split,
            "offset": offset,
            "length": 100,
        },
    )
    response.raise_for_status()
    return response.json()["rows"]


async def fetch_rows(split: str, page_count: int) -> list[dict[str, Any]]:
    timeout = httpx.Timeout(60.0)
    limits = httpx.Limits(max_connections=8, max_keepalive_connections=8)
    async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
        pages = await asyncio.gather(
            *(fetch_page(client, split, offset) for offset in range(0, page_count * 100, 100))
        )
    return [item for page in pages for item in page]


def context_id(source_split: str, context: str) -> str:
    digest = hashlib.sha256(context.encode("utf-8")).hexdigest()[:16]
    return f"klue-mrc-{source_split}-{digest}"


def select_balanced(
    rows: list[dict[str, Any]],
    *,
    source_split: str,
    benchmark_split: str,
    per_label: int,
    excluded_contexts: set[str],
    rng: random.Random,
) -> list[dict[str, Any]]:
    candidates: dict[bool, list[dict[str, Any]]] = defaultdict(list)
    shuffled = rows.copy()
    rng.shuffle(shuffled)
    for item in shuffled:
        row = item["row"]
        identifier = context_id(source_split, row["context"])
        if identifier in excluded_contexts:
            continue
        answerable = not bool(row["is_impossible"])
        candidates[answerable].append(
            {
                "case_id": row["guid"],
                "benchmark_split": benchmark_split,
                "source_split": source_split,
                "source_row_idx": item["row_idx"],
                "document_id": identifier,
                "title": row["title"],
                "context": row["context"],
                "question": row["question"],
                "answerable": answerable,
                "answers": row["answers"],
                "question_type": row["question_type"],
                "source": row["source"],
            }
        )

    selected: list[dict[str, Any]] = []
    used_in_split: set[str] = set()
    for answerable in (True, False):
        for candidate in candidates[answerable]:
            identifier = candidate["document_id"]
            if identifier in used_in_split:
                continue
            selected.append(candidate)
            used_in_split.add(identifier)
            if sum(row["answerable"] is answerable for row in selected) == per_label:
                break
        else:
            raise RuntimeError(
                f"{benchmark_split}에서 answerable={answerable} 표본 {per_label}개를 확보하지 못했습니다."
            )
    excluded_contexts.update(used_in_split)
    rng.shuffle(selected)
    return selected


async def build_sample() -> list[dict[str, Any]]:
    train_rows, validation_rows = await asyncio.gather(
        fetch_rows("train", page_count=18),
        fetch_rows("validation", page_count=12),
    )
    rng = random.Random(SEED)
    excluded_contexts: set[str] = set()
    selected: list[dict[str, Any]] = []
    selected.extend(
        select_balanced(
            train_rows,
            source_split="train",
            benchmark_split="train",
            per_label=150,
            excluded_contexts=excluded_contexts,
            rng=rng,
        )
    )
    selected.extend(
        select_balanced(
            train_rows,
            source_split="train",
            benchmark_split="validation",
            per_label=75,
            excluded_contexts=excluded_contexts,
            rng=rng,
        )
    )
    selected.extend(
        select_balanced(
            validation_rows,
            source_split="validation",
            benchmark_split="test",
            per_label=100,
            excluded_contexts=excluded_contexts,
            rng=rng,
        )
    )
    return selected


def validate(rows: list[dict[str, Any]]) -> None:
    expected = {
        ("train", True): 150,
        ("train", False): 150,
        ("validation", True): 75,
        ("validation", False): 75,
        ("test", True): 100,
        ("test", False): 100,
    }
    assert Counter((row["benchmark_split"], row["answerable"]) for row in rows) == expected
    assert len(rows) == 650
    assert len({row["case_id"] for row in rows}) == len(rows)
    contexts_by_split = {
        split: {row["document_id"] for row in rows if row["benchmark_split"] == split}
        for split in ("train", "validation", "test")
    }
    assert contexts_by_split["train"].isdisjoint(contexts_by_split["validation"])
    assert contexts_by_split["train"].isdisjoint(contexts_by_split["test"])
    assert contexts_by_split["validation"].isdisjoint(contexts_by_split["test"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    rows = asyncio.run(build_sample())
    validate(rows)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in rows) + "\n"
    args.output.write_text(content, encoding="utf-8")
    print(f"saved={args.output} rows={len(rows)} sha256={hashlib.sha256(content.encode()).hexdigest()}")


if __name__ == "__main__":
    main()
