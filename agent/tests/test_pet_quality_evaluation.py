import copy
import json

import pytest

from evaluation.pet_quality import DATASET, evaluation_failure, score_case
from runtime.run_contracts import AgentExecutionError

CASES = json.loads(DATASET.read_text(encoding="utf-8"))["cases"]


def test_evaluation_failure_keeps_known_codes_without_dumping_arbitrary_exception_content():
    error = AgentExecutionError("MODEL_PROVIDER_FAILED")
    error.__cause__ = ValueError("Unsupported quotation evidence")
    assert evaluation_failure(error)["causeCode"] == "Unsupported quotation evidence"
    error.__cause__ = ValueError("private-provider-token-must-not-be-logged")
    details = evaluation_failure(error)
    assert details["errorCode"] == "MODEL_PROVIDER_FAILED"
    assert "private-provider-token" not in json.dumps(details)


def baseline(case):
    # 평가기 자체의 양성 대조군이다. 실제 모델 성능으로 집계하지 않는다.
    items = [] if case["effortDays"] is None else [{
        "title": " · ".join(words[0] for words in case["concepts"]), "description": "합성 평가기 대조군",
        "quantity": case["effortDays"][0], "unit": "DAY"
    }]
    return {"quotation_draft": {"items": items} if items else None,
            "open_questions": [" · ".join(words[0] for words in case["concepts"])] if case["questionsRequired"] else [],
            "pet_messages": [{"evidence_refs": ["web:1"]}],
            "department_results": [{"department": "VERIFICATION", "status": "COMPLETED", "error_code": None},
                                   {"department": "RESEARCH", "status": "COMPLETED", "sources": [{"url": "https://docs.example.test"}]}]}  # noqa: E501


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_each_inquiry_has_a_positive_control_and_rejects_missing_verification(case):
    good = baseline(case)
    assert score_case(case, good)["passed"]
    bad = copy.deepcopy(good)
    bad["department_results"][0]["status"] = "PARTIAL"
    assert not score_case(case, bad)["passed"]


@pytest.mark.parametrize("case", [case for case in CASES if case["effortDays"]], ids=lambda case: case["id"])
def test_unreasonable_effort_and_silent_scope_omissions_fail(case):
    bad = baseline(case)
    bad["quotation_draft"]["items"][0]["quantity"] = 10000
    assert not score_case(case, bad)["passed"]
    bad = baseline(case)
    bad["quotation_draft"]["items"][0]["title"] = "누락된 범위"
    bad["open_questions"] = []
    assert score_case(case, bad)["coverage"] < 1


@pytest.mark.parametrize("case", [case for case in CASES if case["webRequired"]], ids=lambda case: case["id"])
def test_no_web_source_cannot_pass_a_research_case(case):
    bad = baseline(case)
    bad["department_results"][1]["sources"] = []
    assert not score_case(case, bad)["passed"]


def test_clarification_first_preserves_scope_without_pretending_to_have_an_estimate():
    case = next(case for case in CASES if case["id"] == "migration")
    result = baseline(case)
    result["open_questions"] = ["데이터량과 허용 다운타임은 얼마인가요?"]
    assert not score_case(case, result)["passed"]
    review = {"requirements": [{"target": "QUOTATION", "disposition": "QUESTION",
                               "requirement": " · ".join(words[0] for words in case["concepts"]),
                               "original_quote": "백업 복구 리허설"}]}
    assert score_case(case, result, review)["passed"]
    review["requirements"][0]["original_quote"] = "원문에 없는 범위"
    assert not score_case(case, result, review)["passed"]
