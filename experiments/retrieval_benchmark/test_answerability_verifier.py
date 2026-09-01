from __future__ import annotations

from run_answerability_verifier import PairExample, answer_texts, chunk_contains_answer


def test_answer_texts_ignores_annotations_on_impossible_rows() -> None:
    assert answer_texts({"answerable": False, "answers": {"text": ["annotation"]}}) == ()
    assert answer_texts({"answerable": True, "answers": {"text": [" 실제 답 ", ""]}}) == ("실제 답",)


def test_chunk_contains_answer_normalizes_spacing_and_case() -> None:
    assert chunk_contains_answer("계약 해지 사유는 Material Breach입니다.", ("material breach",))
    assert chunk_contains_answer("계약 해지 사유", ("계약해지",))
    assert not chunk_contains_answer("계약 갱신 조건", ("계약 해지",))


def test_pair_example_keeps_binary_label() -> None:
    example = PairExample("case-1", "질문", "근거", True)
    assert example.label is True
