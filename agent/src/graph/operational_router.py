"""Production-shaped route graph: policy gate, LLM decision, optional local shadow."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from functools import lru_cache
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from config import get_settings
from routing import OperationalRouteGateway, SafetyContext, build_openai_route_evaluator


class SafetyContextInput(TypedDict, total=False):
    external_side_effect: bool
    sensitive_data: bool
    financial_authority_required: bool
    legal_authority_required: bool
    irreversible_action: bool
    approval_required: bool
    authority_verified: bool


class OperationalRouterInput(TypedDict, total=False):
    question: str
    safety_context: SafetyContextInput


class OperationalRouterState(TypedDict, total=False):
    question: str
    safety_context: SafetyContextInput
    status: str
    route: str
    source: str
    failure_code: str | None
    model: str | None
    prompt_version: str | None
    prompt_sha256: str | None
    input_tokens: int
    output_tokens: int
    shadow_enabled: bool
    shadow_suggested_route: str | None
    shadow_needs_fallback: bool | None
    shadow_fallback_reason: str | None
    error_code: str


@lru_cache(maxsize=1)
def build_operational_gateway() -> OperationalRouteGateway:
    settings = get_settings()
    evaluator = build_openai_route_evaluator(settings)
    shadow_model = None
    if settings.route_shadow_enabled:
        from graph.router import build_local_route_model

        shadow_model = build_local_route_model()
    return OperationalRouteGateway(evaluator, shadow_model=shadow_model)


def _safety_context(raw: SafetyContextInput | None) -> SafetyContext:
    values = raw or {}
    return SafetyContext(
        external_side_effect=values.get("external_side_effect", False),
        sensitive_data=values.get("sensitive_data", False),
        financial_authority_required=values.get("financial_authority_required", False),
        legal_authority_required=values.get("legal_authority_required", False),
        irreversible_action=values.get("irreversible_action", False),
        approval_required=values.get("approval_required", False),
        authority_verified=values.get("authority_verified", False),
    )


def build_operational_router_graph(
    gateway_provider: Callable[[], OperationalRouteGateway] = build_operational_gateway,
) -> Any:
    async def classify(state: OperationalRouterState) -> dict[str, object]:
        question = state.get("question", "").strip()
        if not question:
            return {"status": "INPUT_REQUIRED", "error_code": "QUESTION_REQUIRED"}

        try:
            gateway = await asyncio.to_thread(gateway_provider)
            decision = await gateway.route(question, _safety_context(state.get("safety_context")))
        except Exception:
            return {
                "status": "HUMAN_REQUIRED",
                "route": "HUMAN_REQUIRED",
                "source": "FAIL_CLOSED",
                "failure_code": "ROUTE_EVALUATOR_UNAVAILABLE",
                "shadow_enabled": False,
            }

        evaluation = decision.llm_evaluation
        shadow = decision.local_decision
        return {
            "status": "HUMAN_REQUIRED" if decision.route.value == "HUMAN_REQUIRED" else "ROUTED",
            "route": decision.route.value,
            "source": decision.source.value,
            "failure_code": decision.failure_code,
            "model": evaluation.model if evaluation is not None else None,
            "prompt_version": evaluation.prompt_version if evaluation is not None else None,
            "prompt_sha256": evaluation.prompt_sha256 if evaluation is not None else None,
            "input_tokens": evaluation.input_tokens if evaluation is not None else 0,
            "output_tokens": evaluation.output_tokens if evaluation is not None else 0,
            "shadow_enabled": shadow is not None,
            "shadow_suggested_route": shadow.suggested_route.value if shadow is not None else None,
            "shadow_needs_fallback": shadow.needs_fallback if shadow is not None else None,
            "shadow_fallback_reason": shadow.fallback_reason if shadow is not None else None,
        }

    builder: StateGraph[
        OperationalRouterState,
        None,
        OperationalRouterInput,
        OperationalRouterState,
    ] = StateGraph(OperationalRouterState, input_schema=OperationalRouterInput)
    builder.add_node("policy_and_llm_route", classify)
    builder.add_edge(START, "policy_and_llm_route")
    builder.add_edge("policy_and_llm_route", END)
    return builder.compile()


graph = build_operational_router_graph()
