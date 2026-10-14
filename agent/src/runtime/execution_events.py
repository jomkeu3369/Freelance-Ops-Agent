"""실행 경로와 도구 사용의 관측 이벤트를 구성한다."""

from __future__ import annotations

from contracts import AgentRunRequest, DepartmentName
from routing import FinalRouteDecision

from .run_contracts import ExecutionEvent


def route_event(request: AgentRunRequest, decision: FinalRouteDecision) -> ExecutionEvent:
    shadow = decision.local_decision
    reason_codes = (
        [decision.policy_code]
        if decision.policy_code is not None
        else [reason.value for reason in decision.llm_evaluation.verdict.reason_codes]
        if decision.llm_evaluation is not None
        else [decision.failure_code or decision.source.value]
    )
    return ExecutionEvent(
        type="route.selected",
        data={
            "route": decision.route.value,
            "provider": request.model_selection.provider.value,
            "model": request.model_selection.model,
            "evaluatorProvider": "OPENAI" if decision.llm_evaluation is not None else None,
            "evaluatorModel": (decision.llm_evaluation.model if decision.llm_evaluation is not None else None),
            "decisionSource": decision.source.value,
            "reasonCodes": reason_codes,
            "evaluatorSuggestedRoute": (
                decision.policy_overrode_route.value if decision.policy_overrode_route is not None else None
            ),
            "shadowSuggestedRoute": shadow.suggested_route.value if shadow is not None else None,
            "shadowNeedsFallback": shadow.needs_fallback if shadow is not None else None,
            "shadowFallbackReason": shadow.fallback_reason if shadow is not None else None,
            "shadowFusedShare": shadow.fused_share if shadow is not None else None,
            "shadowMargin": shadow.margin if shadow is not None else None,
            "shadowLaneAgreement": (
                shadow.bm25_ranking[0].route is shadow.encoder_ranking[0].route if shadow is not None else None
            ),
            "shadowLatencyMs": decision.local_decision_latency_ms,
            "routingLatencyMs": decision.routing_latency_ms,
            "routingInputTokens": (decision.llm_evaluation.input_tokens if decision.llm_evaluation is not None else 0),
            "routingOutputTokens": (
                decision.llm_evaluation.output_tokens if decision.llm_evaluation is not None else 0
            ),
        }
    )


def tool_event(name: str, department: DepartmentName | None = None) -> ExecutionEvent:
    reasons = {
        "get_project_context": "프로젝트 범위, 예산과 확정된 요구사항을 조회하기 위해 사용했습니다.",
        "web_research": "내부 자료만으로 부족한 외부 근거와 출처를 확인하기 위해 사용했습니다.",
    }
    return ExecutionEvent(
        type="tool.completed",
        data={
            "toolName": name,
            "reason": reasons.get(name, "선택된 실행 경로에 필요한 정보를 확인하기 위해 사용했습니다."),
            "department": department.value if department is not None else None,
        }
    )
