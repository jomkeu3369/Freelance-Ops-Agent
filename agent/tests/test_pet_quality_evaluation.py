import copy
import json

import pytest

from evaluation.pet_quality import DATASET, score_case

CASES = json.loads(DATASET.read_text(encoding="utf-8"))["cases"]


def baseline(case):
    # 평가기 자체의 양성 대조군이다. 실제 모델 성능으로 집계하지 않는다.
    items = [] if case["effortDays"] is None else [{
        "title": " · ".join(words[0] for words in case["concepts"]), "description": "합성 평가기 대조군",
        "quantity": case["effortDays"][0], "unit": "DAY"
    }]
    return {"quotation_draft": {"items": items} if items else None,
            "open_questions": [" · ".join(words[0] for words in case["concepts"])] if case["questionsRequired"] else [],
            "department_results": [{"department": "VERIFICATION", "status": "COMPLETED", "error_code": None},
                                   {"department": "RESEARCH", "status": "COMPLETED", "sources": [{}]}]}


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
