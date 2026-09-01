from __future__ import annotations

from run_full_klue_verifier import (
    answer_window,
    build_full_training_pairs,
    lexical_best_window,
    windows,
)


def test_windows_cover_the_tail() -> None:
    chunks = windows("가" * 1000, size=600, stride=450)

    assert chunks[0] == "가" * 600
    assert chunks[-1] == "가" * 600
    assert len(chunks) == 2


def test_answer_window_keeps_answer_near_context_edge() -> None:
    context = "앞" * 700 + "정답"

    assert "정답" in answer_window(context, 700, "정답", size=600)


def test_lexical_window_selects_question_overlap() -> None:
    context = "사과 " * 200 + "계약 해지 조건은 위약이다."

    assert "계약 해지" in lexical_best_window("계약 해지 조건", context)


def test_full_training_pairs_are_label_balanced() -> None:
    rows = [
        {
            "guid": "positive",
            "question": "정답은?",
            "context": "앞 문장 정답 뒤 문장",
            "is_impossible": False,
            "answers": {"text": ["정답"], "answer_start": [5]},
        },
        {
            "guid": "negative",
            "question": "없는 답은?",
            "context": "관련 문맥만 있습니다.",
            "is_impossible": True,
            "answers": {"text": [], "answer_start": []},
        },
    ]

    pairs = build_full_training_pairs(rows, excluded_case_ids=set())

    assert sum(pair.label for pair in pairs) == 1
    assert sum(not pair.label for pair in pairs) == 1
