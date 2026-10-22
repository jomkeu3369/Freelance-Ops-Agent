"""사람이 정한 문의별 범위·공수 구간과 독립 검증 결과를 함께 평가한다."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
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
    PetEvidence,
    PetMessage,
    PetProfile,
    PlatformBudget,
    ProjectContext,
    Provider,
    QuotationDraft,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from platform_budget import TARIFF_VERSION, PlatformSpendLedger, platform_budget_scope
from providers import ModelGeneration, OpenAIModelProvider
from providers.conversation_quality import ConversationReview, QualityOperation
from runtime.bootstrap import build_conversation_research_service
from runtime.conversation_quality import ConversationQuality
from runtime.pet_conversation import execute_conversation

DATASET = Path(__file__).resolve().parents[2] / "evaluation/pet-inquiries-v1.json"
TOTAL_CAP = Decimal("2.40")


class RecordingProvider(OpenAIModelProvider):
    last_review: ConversationReview | None = None

    async def generate_conversation_quality(self, selection: ModelSelection, prompt: str, *, operation: QualityOperation, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        result = await super().generate_conversation_quality(
            selection, prompt, operation=operation, max_output_tokens=max_output_tokens, max_attempts=max_attempts
        )
        if operation == "conversation_review":
            self.last_review = ConversationReview.model_validate(result.payload)
        return result


def score_case(case: dict[str, Any], result: dict[str, Any], review: dict[str, Any] | None = None) -> dict[str, Any]:
    draft = result.get("quotation_draft")
    items = draft.get("items", []) if draft else []
    questions = result.get("open_questions", [])
    # 발화의 말만으로 견적 범위에 반영됐다고 인정하지 않는다.
    scope = json.dumps(items, ensure_ascii=False).casefold()
    scope_and_questions = scope + " ".join(questions).casefold()
    trace_coverage = bool(case.get("clarificationFirst") and not items and questions and review)
    if trace_coverage:
        # 먼저 질문하라는 문의는 요구 범위를 보존한 검토표로 확인한다. 구현했다고 인정하는 점수가 아니다.
        scope_and_questions += json.dumps([
            check["requirement"] for check in (review or {}).get("requirements", [])
            if check["target"] == "QUOTATION" and check["disposition"] == "QUESTION"
            and check["original_quote"].strip() and check["original_quote"] in case["inquiry"]
        ], ensure_ascii=False).casefold()
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
    web_cited = any(ref.startswith("web:") for message in result.get("pet_messages", [])
                    for ref in message.get("evidence_refs", []))
    web_cited = web_cited or any(item.get("basis", {}).get("source_reference") in {
        source["url"] for source in web.get("sources", [])
    } for item in items)
    web_ok = not case["webRequired"] or (web.get("status") == "COMPLETED" and bool(web.get("sources")) and web_cited)
    forbidden = [term for term in case["forbiddenScope"] if any(term in item["title"] for item in items)]
    passed = (coverage == len(concepts) and effort_ok and verified and web_ok and not forbidden
              and (not case["questionsRequired"] or bool(questions)))
    return {"id": case["id"], "passed": passed, "coverage": coverage / len(concepts),
            "coverageBasis": "DEFERRED_SCOPE_TRACE" if trace_coverage else "ITEMS_OR_QUESTIONS",
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


def evaluation_ledger(request: AgentRunRequest, spent: Decimal) -> PlatformSpendLedger:
    if spent >= TOTAL_CAP:
        raise ValueError("EVALUATION_SPEND_CAP_EXCEEDED")
    return PlatformSpendLedger(PlatformBudget(
        reservation_id=request.context.run_id, max_cost_usd=min(Decimal("0.20"), TOTAL_CAP - spent),
        tariff_version=TARIFF_VERSION, valid_until=datetime.now(UTC) + timedelta(minutes=3)
    ), run_budget=request.budget)


def defect_detected(review: ConversationReview | None, dimension: str) -> bool:
    if review is None:
        return False
    if dimension == "COVERAGE":
        return any(check.disposition == "MISSING" for check in review.requirements)
    if dimension == "EFFORT":
        return any(check.verdict in {"UNJUSTIFIED", "IMPLAUSIBLE"} for check in review.effort_checks)
    return any(check.verdict == "UNSUPPORTED" for check in review.evidence_checks)


async def calibration_controls(provider: RecordingProvider, model: str, spent: Decimal) -> tuple[list[dict[str, Any]], Decimal]:  # noqa: E501
    cases = [
        ("COVERAGE", "예약 신청과 취소, 관리자 환불과 통합 테스트를 모두 포함해줘.",
         "예약 신청 화면만 만들고 취소·환불·테스트는 모두 제외", 2, "예약 신청만 2일로 가정했어."),
        ("EFFORT", "50개 지점의 신규 ERP에서 재고·결제·배송·정산·권한·테스트·운영 배포가 필요해.",
         "신규 설계부터 모든 기능과 테스트·배포까지 한 명이 구현", 0.01,
         "모든 신규 ERP 구현을 4.8분이면 끝낼 수 있어."),
        ("EVIDENCE", "평가용 가상 결제 API의 이벤트 중복 제약에 맞게 초안을 검토해줘.",
         "중복 이벤트가 없으므로 중복 처리를 전혀 만들지 않음", 2,
         "이 가상 API는 같은 이벤트를 절대로 다시 보내지 않아."),
    ]
    scores: list[dict[str, Any]] = []
    for dimension, original, description, days, message_text in cases:
        request, project = evaluation_request(original, model)
        ledger = evaluation_ledger(request, spent)
        provider.last_review = None
        evidence = {"attachment:0": PetEvidence(id="attachment:0", title="가상 API · 합성 평가 명세",
                    content="이 평가용 API는 같은 event_id를 여러 번 전송할 수 있다. 수신자는 중복 처리를 해야 한다.")}
        draft = QuotationDraft.model_validate({"items": [{"title": "구현", "description": description,
            "quantity": days, "unit": "DAY", "basis": {"type": "ASSUMPTION", "content": description}}]})
        message = PetMessage(message_id=uuid4(), text=message_text,
                             evidence_refs=["attachment:0"] if dimension == "EVIDENCE" else [])
        quality = ConversationQuality(provider, request, None)
        try:
            async with asyncio.timeout(180):
                with platform_budget_scope(ledger):
                    await quality.verify(project, original, evidence, [message], draft, (0, 0, 0))
            passed = (quality.verification.error_code == "CONVERSATION_VERIFICATION_FAILED"
                      and defect_detected(provider.last_review, dimension))
            score: dict[str, Any] = {"dimension": dimension, "passed": passed,
                                     "review": provider.last_review.model_dump() if provider.last_review else None,
                                     "verification": quality.verification.model_dump(mode="json")}
        except Exception as error:
            score = {"dimension": dimension, "passed": False, "errorType": type(error).__name__}
        spent += ledger.cost
        score["costUpperBoundUsd"] = str(ledger.cost)
        scores.append(score)
        print(json.dumps({"control": dimension, "passed": score["passed"]}), flush=True)
    return scores, spent


async def run_live(dataset: dict[str, Any], model: str, output: Path, selected: list[str]) -> None:
    from config import get_settings

    research = build_conversation_research_service(get_settings())
    cases = [case for case in dataset["cases"] if not selected or case["id"] in selected]
    if not cases:
        raise ValueError("평가할 문의가 없습니다.")
    if any(case["webRequired"] for case in cases) and research is None:
        raise ValueError("웹 조사 사례는 설정된 검색 서비스와 도메인 허용 목록이 필요합니다.")
    report: dict[str, Any] = {"mode": "LIVE_MODEL", "dataset": dataset["version"], "model": model, "cases": [],
                             "revision": os.getenv("EVALUATION_REVISION"), "startedAt": datetime.now(UTC).isoformat()}
    provider = RecordingProvider(max_attempts=1)
    spent = Decimal("0")
    output.parent.mkdir(parents=True, exist_ok=True)
    for case in cases:
        request, project = evaluation_request(case["inquiry"], model)
        if case.get("acceptedDraft"):
            assert request.input.conversation is not None
            request.input.conversation.accepted_draft = case["acceptedDraft"]
        ledger = evaluation_ledger(request, spent)
        provider.last_review = None
        try:
            async with asyncio.timeout(request.budget.max_duration_seconds):
                with platform_budget_scope(ledger):
                    outcome = await execute_conversation(provider, request, project, case["inquiry"], research)
            result = outcome.result.model_dump(mode="json") if outcome.result else {}
            review = provider.last_review.model_dump() if provider.last_review else None
            score = score_case(case, result, review)
            score["result"] = result
            score["review"] = review
            score["usage"] = ledger.report(outcome.usage).model_dump(mode="json")
            score["costUpperBoundUsd"] = str(ledger.cost)
        except Exception as error:
            score = {"id": case["id"], "passed": False, "errorType": type(error).__name__,
                     "costUpperBoundUsd": str(ledger.cost)}
        report["cases"].append(score)
        spent += ledger.cost
        report["costUpperBoundUsd"] = str(spent)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"id": case["id"], "passed": score["passed"]}, ensure_ascii=False), flush=True)
    report["calibrationControls"], spent = await calibration_controls(provider, model, spent)
    report["costUpperBoundUsd"] = str(spent)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if not all(case["passed"] for case in [*report["cases"], *report["calibrationControls"]]):
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="운영자 실행용 유료 펫 품질 평가. 전체 비용 상한 2.40 USD.")
    parser.add_argument("--live", action="store_true", required=True)
    parser.add_argument("--model", default="gpt-6-luna")
    parser.add_argument("--case", action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    asyncio.run(run_live(dataset, args.model, args.output, args.case))


if __name__ == "__main__":
    main()
