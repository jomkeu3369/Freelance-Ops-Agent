from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from prepare_klue_mrc_sample import validate
from run_klue_mrc_benchmark import load_dataset

DATA_PATH = Path(__file__).parent / "data" / "klue_mrc_answerability_650.jsonl"


def load_rows() -> list[dict[str, object]]:
    return [json.loads(line) for line in DATA_PATH.read_text(encoding="utf-8").splitlines() if line]


def test_klue_sample_is_balanced_unique_and_context_disjoint() -> None:
    rows = load_rows()

    validate(rows)
    assert Counter((row["benchmark_split"], row["answerable"]) for row in rows) == {
        ("train", True): 150,
        ("train", False): 150,
        ("validation", True): 75,
        ("validation", False): 75,
        ("test", True): 100,
        ("test", False): 100,
    }


def test_benchmark_loader_preserves_cases_and_answerability_contract() -> None:
    rows = load_rows()
    documents, cases = load_dataset(DATA_PATH)

    assert len(documents) == 650
    assert len(cases) == 650
    assert {case.case_id for case in cases} == {str(row["case_id"]) for row in rows}
    assert all(case.relevant_document_ids for case in cases if case.answerable)
    assert all(not case.relevant_document_ids for case in cases if not case.answerable)
