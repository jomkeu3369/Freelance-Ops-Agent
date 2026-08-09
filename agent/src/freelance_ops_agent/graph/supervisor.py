from collections.abc import Callable, Hashable
from typing import Any, NotRequired, TypedDict, cast

from langgraph.graph import END, START, StateGraph

from freelance_ops_agent.contracts import DepartmentName, DepartmentResult, RequestTier

DEPARTMENT_ORDER = [
    DepartmentName.REQUIREMENTS,
    DepartmentName.RESEARCH,
    DepartmentName.DEAL_DESIGN,
    DepartmentName.VERIFICATION
]


class WorkflowState(TypedDict):
    request_tier: str
    max_departments: int
    selected_departments: NotRequired[list[str]]
    completed_departments: NotRequired[list[str]]
    department_results: NotRequired[list[dict[str, object]]]
    active_department: NotRequired[str | None]
    status: NotRequired[str]


def select_departments(request_tier: RequestTier, max_departments: int) -> list[DepartmentName]:
    if request_tier == RequestTier.DIRECT_TOOL:
        return []
    if request_tier in {RequestTier.SINGLE_AGENT, RequestTier.DEPARTMENT}:
        return [DepartmentName.REQUIREMENTS]
    return DEPARTMENT_ORDER[:max_departments]


def global_orchestrator(state: WorkflowState) -> dict[str, object]:
    request_tier = RequestTier(state["request_tier"])
    selected = select_departments(request_tier, state["max_departments"])
    return {
        "selected_departments": [department.value for department in selected],
        "completed_departments": [],
        "department_results": [],
        "active_department": selected[0].value if selected else None,
        "status": "RUNNING" if selected else "COMPLETED"
    }


def department_node(department: DepartmentName) -> Callable[[WorkflowState], dict[str, object]]:
    def run_department(state: WorkflowState) -> dict[str, object]:
        selected = state.get("selected_departments", [])
        if department.value not in selected:
            return {}
        result = DepartmentResult(
            department=department,
            status="COMPLETED",
            summary=f"{department.value} scaffold completed"
        )
        completed = [*state.get("completed_departments", []), department.value]
        results = [*state.get("department_results", []), result.model_dump(mode="json")]
        remaining = [name for name in selected if name not in completed]
        return {
            "completed_departments": completed,
            "department_results": results,
            "active_department": remaining[0] if remaining else None,
            "status": "RUNNING" if remaining else "COMPLETED"
        }

    return run_department


def route_after_orchestrator(state: WorkflowState) -> str:
    selected = state.get("selected_departments", [])
    return selected[0].lower() if selected else "end"


def route_after_department(state: WorkflowState) -> str:
    active_department = state.get("active_department")
    return active_department.lower() if active_department else "end"


def build_supervisor_graph() -> Any:
    builder: StateGraph[WorkflowState, None, WorkflowState, WorkflowState] = StateGraph(WorkflowState)
    builder.add_node("global_orchestrator", global_orchestrator)
    for department in DEPARTMENT_ORDER:
        builder.add_node(department.value.lower(), cast(Any, department_node(department)))
    builder.add_edge(START, "global_orchestrator")
    route_map: dict[Hashable, str] = {
        department.value.lower(): department.value.lower() for department in DEPARTMENT_ORDER
    }
    route_map["end"] = END
    builder.add_conditional_edges("global_orchestrator", route_after_orchestrator, route_map)
    for department in DEPARTMENT_ORDER:
        builder.add_conditional_edges(department.value.lower(), route_after_department, route_map)
    return builder.compile()
