from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RequirementExample:
    id: str
    text: str
    label: int


def load_requirement_dataset(dataset_config: dict[str, Any]) -> dict[str, list[RequirementExample]]:
    """설정한 데이터셋을 내려받아 학습·검증·테스트 형식을 맞춘다."""
    from datasets import load_dataset

    dataset = load_dataset(dataset_config["id"])
    text_column = dataset_config["text_column"]
    label_column = dataset_config["label_column"]
    normalized: dict[str, list[RequirementExample]] = {}
    for split_name in ("train", "validation", "val", "test"):
        if split_name not in dataset:
            continue
        canonical = "validation" if split_name == "val" else split_name
        normalized[canonical] = [
            RequirementExample(
                id=f"{canonical}-{index}",
                text=str(row[text_column]).strip(),
                label=int(row[label_column])
            )
            for index, row in enumerate(dataset[split_name])
        ]
    if not {"train", "validation", "test"}.issubset(normalized):
        raise ValueError(f"Expected train/validation/test splits, got {sorted(normalized)}")
    return normalized


def stratified_limit(rows: list[RequirementExample], limit: int | None, *, seed: int) -> list[RequirementExample]:
    """고정 시드로 레이블별 표본 수를 맞춘 소규모 검사 데이터를 만든다."""
    if limit is None or limit >= len(rows):
        return rows
    if limit < 2:
        raise ValueError("A stratified limit must be at least 2")
    rng = random.Random(seed)
    by_label: dict[int, list[RequirementExample]] = {}
    for row in rows:
        by_label.setdefault(row.label, []).append(row)
    selected: list[RequirementExample] = []
    base = limit // len(by_label)
    for label_rows in by_label.values():
        shuffled = list(label_rows)
        rng.shuffle(shuffled)
        selected.extend(shuffled[:base])
    remaining = [row for row in rows if row not in selected]
    rng.shuffle(remaining)
    selected.extend(remaining[: limit - len(selected)])
    rng.shuffle(selected)
    return selected
