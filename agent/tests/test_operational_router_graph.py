from graph.operational_router import build_operational_router_graph


class UnavailableGatewayProvider:
    def __call__(self) -> None:
        raise RuntimeError("private configuration detail")


async def test_operational_graph_requires_a_question() -> None:
    graph = build_operational_router_graph(UnavailableGatewayProvider())

    result = await graph.ainvoke({})

    assert result["status"] == "INPUT_REQUIRED"
    assert result["error_code"] == "QUESTION_REQUIRED"


async def test_operational_graph_fails_closed_without_private_evaluator() -> None:
    graph = build_operational_router_graph(UnavailableGatewayProvider())

    result = await graph.ainvoke({"question": "요청을 분류해 주세요"})

    assert result["status"] == "HUMAN_REQUIRED"
    assert result["route"] == "HUMAN_REQUIRED"
    assert result["source"] == "FAIL_CLOSED"
    assert result["failure_code"] == "ROUTE_EVALUATOR_UNAVAILABLE"
    assert "private" not in str(result)
