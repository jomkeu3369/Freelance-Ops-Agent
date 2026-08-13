"""LangGraph Studio diagnostic entrypoint for the local hybrid router."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from routing.hybrid import HybridRouteModel, RouteDecision, RouteLabel, load_route_examples
from routing.liquid_encoder import LiquidEncoderRouteScorer


class RouterDiagnosticState(TypedDict, total=False):
    question: str
    status: str
    route: str | None
    suggested_route: str
    needs_llm_evaluator: bool
    fallback_reason: str | None
    fused_share: float
    margin: float
    encoder_model_id: str
    matched_example_ids: list[str]
    bm25_ranking: list[dict[str, object]]
    encoder_ranking: list[dict[str, object]]
    fused_ranking: list[dict[str, object]]
    error_code: str


class RouterDiagnosticInput(TypedDict):
    question: str


ROUTE_DESCRIPTIONS = {
    RouteLabel.DIRECT_TOOL: "one exact deterministic operation over supplied structured values",
    RouteLabel.SIMPLE_LLM: "one model response without tools or delegation",
    RouteLabel.REACT_AGENT: "bounded iterative tool use within one specialist domain",
    RouteLabel.SUPERVISOR: "coordination and synthesis across multiple specialist domains",
    RouteLabel.HUMAN_REQUIRED: "human review for authority, sensitive data, or consequential action",
}


@lru_cache(maxsize=1)
def build_local_route_model() -> HybridRouteModel:
    repository_root = Path(__file__).resolve().parents[3]
    benchmark_root = repository_root / "experiments" / "routing_benchmark"
    examples = load_route_examples(benchmark_root / "data" / "generated-v1" / "train.jsonl")
    encoder = LiquidEncoderRouteScorer(
        model_id="LiquidAI/LFM2.5-Encoder-350M-Prompt-Router",
        revision="35ca4a0469f180f1cf05a630df8842fa17ac18e3",
        head_path=benchmark_root / "checkpoints" / "a1" / "curve-2500" / "head.safetensors",
        route_descriptions=ROUTE_DESCRIPTIONS,
        device="auto",
    )
    return HybridRouteModel(examples, encoder)


def _ranking(items: tuple[Any, ...]) -> list[dict[str, object]]:
    return [
        {"route": item.route.value, "rank": item.rank, "score": item.score}
        for item in items
    ]


def _decision_output(decision: RouteDecision, model: HybridRouteModel) -> dict[str, object]:
    return {
        "status": "ROUTED" if not decision.needs_fallback else "LLM_EVALUATION_REQUIRED",
        "route": decision.route.value if decision.route is not None else None,
        "suggested_route": decision.suggested_route.value,
        "needs_llm_evaluator": decision.needs_fallback,
        "fallback_reason": decision.fallback_reason,
        "fused_share": decision.fused_share,
        "margin": decision.margin,
        "encoder_model_id": model.encoder_model_id,
        "matched_example_ids": list(decision.matched_example_ids),
        "bm25_ranking": _ranking(decision.bm25_ranking),
        "encoder_ranking": _ranking(decision.encoder_ranking),
        "fused_ranking": _ranking(decision.fused_ranking),
    }


def build_router_diagnostic_graph(
    model_provider: Callable[[], HybridRouteModel] = build_local_route_model,
) -> Any:
    async def classify(state: RouterDiagnosticState) -> dict[str, object]:
        question = state.get("question", "").strip()
        if not question:
            return {"status": "INPUT_REQUIRED", "error_code": "QUESTION_REQUIRED"}
        try:
            model = await asyncio.to_thread(model_provider)
            decision = await model.route(question)
        except (OSError, RuntimeError, ValueError):
            return {
                "status": "CONFIGURATION_ERROR",
                "error_code": "LOCAL_ROUTER_UNAVAILABLE",
            }
        return _decision_output(decision, model)

    builder: StateGraph[
        RouterDiagnosticState,
        None,
        RouterDiagnosticInput,
        RouterDiagnosticState,
    ] = StateGraph(RouterDiagnosticState, input_schema=RouterDiagnosticInput)
    builder.add_node("classify_route", classify)
    builder.add_edge(START, "classify_route")
    builder.add_edge("classify_route", END)
    return builder.compile()


graph = build_router_diagnostic_graph()
