from contracts import DepartmentName, RequestTier
from graph.supervisor import build_supervisor_graph, select_departments


def test_single_agent_selects_requirements_only() -> None:
    selected = select_departments(RequestTier.SINGLE_AGENT, max_departments=4)

    assert selected == [DepartmentName.REQUIREMENTS]


def test_multi_department_graph_respects_department_budget() -> None:
    graph = build_supervisor_graph()

    result = graph.invoke({"request_tier": "MULTI_DEPARTMENT", "max_departments": 3})

    assert result["status"] == "COMPLETED"
    assert result["completed_departments"] == ["REQUIREMENTS", "RESEARCH", "DEAL_DESIGN"]
    assert len(result["department_results"]) == 3


def test_graph_returns_structured_error_when_required_input_is_missing() -> None:
    graph = build_supervisor_graph()

    result = graph.invoke({})

    assert result["status"] == "INPUT_REQUIRED"
    assert result["error_code"] == "MISSING_SUPERVISOR_INPUT"
    assert result["missing_fields"] == ["request_tier", "max_departments"]
    assert result["selected_departments"] == []


def test_graph_rejects_invalid_department_budget() -> None:
    graph = build_supervisor_graph()

    result = graph.invoke({"request_tier": "MULTI_DEPARTMENT", "max_departments": 5})

    assert result["status"] == "INPUT_REQUIRED"
    assert result["error_code"] == "INVALID_MAX_DEPARTMENTS"


def test_graph_rejects_unknown_request_tier() -> None:
    graph = build_supervisor_graph()

    result = graph.invoke({"request_tier": "UNKNOWN", "max_departments": 2})

    assert result["status"] == "INPUT_REQUIRED"
    assert result["error_code"] == "INVALID_REQUEST_TIER"
