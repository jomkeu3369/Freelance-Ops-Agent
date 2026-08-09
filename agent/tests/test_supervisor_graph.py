from freelance_ops_agent.contracts import DepartmentName, RequestTier
from freelance_ops_agent.graph.supervisor import build_supervisor_graph, select_departments


def test_single_agent_selects_requirements_only() -> None:
    selected = select_departments(RequestTier.SINGLE_AGENT, max_departments=4)

    assert selected == [DepartmentName.REQUIREMENTS]


def test_multi_department_graph_respects_department_budget() -> None:
    graph = build_supervisor_graph()

    result = graph.invoke({"request_tier": "MULTI_DEPARTMENT", "max_departments": 3})

    assert result["status"] == "COMPLETED"
    assert result["completed_departments"] == [
        "REQUIREMENTS",
        "RESEARCH",
        "DEAL_DESIGN"
    ]
    assert len(result["department_results"]) == 3

