from __future__ import annotations

import json

from run_llm_answerability_benchmark import Verdict, build_user_input


def test_llm_payload_does_not_include_reference_label() -> None:
    payload = json.loads(build_user_input("질문", ["근거 1", "근거 2"]))

    assert payload == {
        "question": "질문",
        "passages": [{"chunk": 1, "text": "근거 1"}, {"chunk": 2, "text": "근거 2"}],
    }
    assert "answerable" not in payload


def test_verdict_rejects_unknown_fields() -> None:
    verdict = Verdict.model_validate({"answerable": False, "confidence": 0.9, "evidence_chunk": None})
    assert verdict.answerable is False
