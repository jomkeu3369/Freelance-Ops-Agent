"""사람이 정한 문의별 범위·공수 구간과 독립 검증 결과를 함께 평가한다."""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import uuid4

from contracts import (
    AgentInput,
    AgentRunRequest,
    ModelSelection,
    PetConversation,
    PetProfile,
    PlatformBudget,
    ProjectContext,
    Provider,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from platform_budget import PlatformSpendLedger, platform_budget_scope
from providers import OpenAIModelProvider
from runtime.bootstrap import build_conversation_research_service
from runtime.pet_conversation import execute_conversation

DATASET = Path(__file__).resolve().parents[2] / "evaluation/pet-inquiries-v1.json"


def score_case(case: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    draft = result.get("quotation_draft")
    items = draft.get("items", []) if draft else []
    questions = result.get("open_questions", [])
    # 발화의 말만으로 견적 범위에 반영됐다고 인정하지 않는다.
    scope = json.dumps(items, ensure_ascii=False).casefold()
    scope_and_questions = scope + " ".join(questions).casefold()
    concepts = case["concepts"]
    coverage = sum(any(term.casefold() in scope_and_questions for term in alternatives) for alternatives in concepts)
    missed = [alternatives for alternatives in concepts if not any(term.casefold() in scope_and_questions for term in alternatives)]  # noqa: E501
    effort = sum(float(item["quantity"]) / 8 if item["unit"] == "HOUR" else float(item["quantity"])
                 for item in items if item["unit"] != "FIXED")
    limits = case["effortDays"]
    effort_ok = ((limits is None and not items)
                 or (bool(items) and limits is not None and limits[0] <= effort <= limits[1]))
    # FIXED는 날짜로 환산할 수 없으므로 공수 범위 점수를 통과시킬 수 없다.
    if limits is not None and any(item["unit"] == "FIXED" for item in items):
        effort_ok = False
    departments = result.get("department_results", [])
    verified = any(item["department"] == "VERIFICATION" and item["status"] == "COMPLETED"
                   and not item.get("error_code") for item in departments)
    web: dict[str, Any] = next((item for item in departments if item["department"] == "RESEARCH"), {})
    web_ok = not case["webRequired"] or (web.get("status") == "COMPLETED" and bool(web.get("sources")))
    forbidden = [term for term in case["forbiddenScope"] if any(term in item["title"] for item in items)]
    passed = (coverage == len(concepts) and effort_ok and verified and web_ok and not forbidden
              and (not case["questionsRequired"] or bool(questions)))
    return {"id": case["id"], "passed": passed, "coverage": coverage / len(concepts),
            "missingConcepts": missed, "effortDays": effort, "effortInReviewRange": effort_ok,
            "independentlyVerified": verified, "webEvidenceAvailable": web_ok, "forbiddenScope": forbidden,
            "questionsPresent": bool(questions)}


def evaluation_request(inquiry: str, model: str) -> tuple[AgentRunRequest, ProjectContext]:
    workspace, project_id, run_id = uuid4(), uuid4(), uuid4()
    profiles = [PetProfile(slot="RECOMMENDED", name=name, animal="cat", color="peach", accessory="none",
                           tone="WARM", value_priority="BALANCED", delivery_priority="QUALITY",
                           scope_priority="BALANCED", pet_id=uuid4()) for name in ["꼼꼼", "든든", "차근"]]
    request = AgentRunRequest(
        context=TrustedRunContext(run_id=run_id, thread_id=uuid4(), trace_id="pet-quality-live-eval",
                                  workspace_id=workspace, project_id=project_id, initiated_by=uuid4(),
                                  effective_permissions=["agent.run", "project.read", "document.read"]),
        budget=RunBudget(max_duration_seconds=180, max_model_calls=5, max_tool_calls=5, max_input_tokens=150000,
                         max_output_tokens=24000, max_departments=2, max_hierarchy_depth=1, max_search_credits=1),
        model_selection=ModelSelection(provider=Provider.OPENAI, model=model), safety_context=SafetyContextInput(),
        input=AgentInput(requirement_text=inquiry, pet_profiles=profiles,
                         conversation=PetConversation(pet_mode=True, debate_enabled=True))
    )
    project = ProjectContext(project_id=project_id, workspace_id=workspace, title="합성 평가 문의",
                             requirement_text=inquiry, currency="KRW")
    return request, project


async def run_live(dataset: dict[str, Any], model: str, output: Path, selected: list[str]) -> None:
    from config import get_settings

    research = build_conversation_research_service(get_settings())
    cases = [case for case in dataset["cases"] if not selected or case["id"] in selected]
    if not cases:
        raise ValueError("평가할 문의가 없습니다.")
    if any(case["webRequired"] for case in cases) and research is None:
        raise ValueError("웹 조사 사례는 설정된 검색 서비스와 도메인 허용 목록이 필요합니다.")
    report: dict[str, Any] = {"mode": "LIVE_MODEL", "dataset": dataset["version"], "model": model, "cases": []}
    provider = OpenAIModelProvider(max_attempts=1)
    output.parent.mkdir(parents=True, exist_ok=True)
    for case in cases:
        request, project = evaluation_request(case["inquiry"], model)
        if case.get("acceptedDraft"):
            assert request.input.conversation is not None
            request.input.conversation.accepted_draft = case["acceptedDraft"]
        ledger = PlatformSpendLedger(PlatformBudget(
            reservation_id=request.context.run_id, max_cost_usd=Decimal("0.20"),
            tariff_version="platform-ai-2026-10-05-v2", valid_until=datetime.now(UTC) + timedelta(minutes=3)
        ), run_budget=request.budget)
        try:
            async with asyncio.timeout(request.budget.max_duration_seconds):
                with platform_budget_scope(ledger):
                    outcome = await execute_conversation(provider, request, project, case["inquiry"], research)
            result = outcome.result.model_dump(mode="json") if outcome.result else {}
            score = score_case(case, result)
            score["result"] = result
            score["costUpperBoundUsd"] = str(ledger.cost)
        except (RuntimeError, ValueError, TimeoutError) as error:
            score = {"id": case["id"], "passed": False, "errorType": type(error).__name__,
                     "costUpperBoundUsd": str(ledger.cost)}
        report["cases"].append(score)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"id": case["id"], "passed": score["passed"]}, ensure_ascii=False), flush=True)
    if not all(case["passed"] for case in report["cases"]):
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="운영자 실행용 유료 펫 품질 평가. 최대 0.20 USD × 사례 수.")
    parser.add_argument("--live", action="store_true", required=True)
    parser.add_argument("--model", default="gpt-6-luna")
    parser.add_argument("--case", action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    asyncio.run(run_live(dataset, args.model, args.output, args.case))


if __name__ == "__main__":
    main()
