from collections.abc import Mapping

import pytest

from graph.router import build_router_diagnostic_graph
from routing import HybridRouteModel, RouteExample, RouteLabel


class FixedEncoder:
    model_id = "test-encoder"

    async def score_routes(self, text: str) -> Mapping[RouteLabel, float]:
        del text
        return {route: 1.0 if route is RouteLabel.DIRECT_TOOL else 0.1 for route in RouteLabel}


def _model() -> HybridRouteModel:
    examples = (
        RouteExample("direct", "calculate exact invoice total", RouteLabel.DIRECT_TOOL),
        RouteExample("simple", "rewrite a supplied sentence", RouteLabel.SIMPLE_LLM),
        RouteExample("react", "search documentation and test code", RouteLabel.REACT_AGENT),
        RouteExample("supervisor", "coordinate legal design and engineering", RouteLabel.SUPERVISOR),
        RouteExample("human", "approve an irreversible financial action", RouteLabel.HUMAN_REQUIRED),
    )
    return HybridRouteModel(examples, FixedEncoder())


@pytest.mark.asyncio
async def test_router_diagnostic_accepts_a_question() -> None:
    graph = build_router_diagnostic_graph(_model)

    result = await graph.ainvoke({"question": "calculate exact invoice total"})

    assert result["status"] == "ROUTED"
    assert result["route"] == "DIRECT_TOOL"
    assert result["encoder_model_id"] == "test-encoder"
    assert result["bm25_ranking"][0]["route"] == "DIRECT_TOOL"
    assert result["fused_ranking"][0]["route"] == "DIRECT_TOOL"


@pytest.mark.asyncio
async def test_router_diagnostic_requires_a_question() -> None:
    graph = build_router_diagnostic_graph(_model)

    result = await graph.ainvoke({})

    assert result["status"] == "INPUT_REQUIRED"
    assert result["error_code"] == "QUESTION_REQUIRED"


@pytest.mark.asyncio
async def test_router_diagnostic_redacts_model_loading_errors() -> None:
    def unavailable_model() -> HybridRouteModel:
        raise OSError("C:/private/model/path is unavailable")

    graph = build_router_diagnostic_graph(unavailable_model)

    result = await graph.ainvoke({"question": "route this request"})

    assert result["status"] == "CONFIGURATION_ERROR"
    assert result["error_code"] == "LOCAL_ROUTER_UNAVAILABLE"
    assert "private" not in str(result)
