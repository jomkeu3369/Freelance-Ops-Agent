from datetime import UTC, datetime
from uuid import uuid4

import pytest

from contracts import DepartmentName, ModelSelection, Provider, RunBudget
from routing import ExecutionRisk, ToolProfile
from runtime import DepartmentTask, ExecutionRoute, TaskExecutionSnapshot, TaskGuard, TaskGuardRejection


def budget(*, model_calls: int = 2) -> RunBudget:
    return RunBudget(max_duration_seconds=60, max_model_calls=model_calls, max_tool_calls=2,
                     max_input_tokens=1000, max_output_tokens=1000, max_departments=1,
                     max_hierarchy_depth=1)


def task(*, permissions: list[str] | None = None, task_budget: RunBudget | None = None,
         risk: ExecutionRisk = ExecutionRisk.MEDIUM, tool_profile: ToolProfile = ToolProfile.READ_ONLY,
         authorization_revision: int = 3, model_profile: str = "react-read-v1",
         guard_policy_version: str = "task-guard-v1",
         route: ExecutionRoute = ExecutionRoute.REACT_AGENT) -> DepartmentTask:
    snapshot = TaskExecutionSnapshot(
        route=route,
        permissions=permissions or ["agent.run", "project.read"],
        budget=task_budget or budget(),
        model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
        policy_version="task-guard-v1",
        prompt_version="research-v1",
        tool_schema_version="spring-tool-v1",
        risk_level=risk,
        tool_profile=tool_profile,
        model_profile=model_profile,
        guard_policy_version=guard_policy_version,
        authorization_revision=authorization_revision,
        budget_revision=2,
    )
    return DepartmentTask(task_id=uuid4(), run_id=uuid4(), workspace_id=uuid4(), project_id=uuid4(),
                          department=DepartmentName.RESEARCH, revision=1, execution=snapshot,
                          created_at=datetime.now(UTC))


def validate(value: DepartmentTask) -> None:
    TaskGuard().validate(value, current_permissions={"agent.run", "project.read"},
                         current_authorization_revision=3, current_budget_revision=2,
                         parent_budget=budget(model_calls=4))


def test_guard_accepts_current_least_privilege_read_only_profile() -> None:
    validate(task())


@pytest.mark.parametrize(
    ("value", "code"),
    [
        (task(authorization_revision=2), "AUTHORIZATION_REVISION_STALE"),
        (task(permissions=["agent.run"]), "PERMISSION_DENIED"),
        (task(permissions=["agent.run", "project.write"]), "PERMISSION_DENIED"),
        (task(task_budget=budget(model_calls=5)), "BUDGET_EXCEEDED"),
        (task(risk=ExecutionRisk.RESTRICTED), "HUMAN_APPROVAL_REQUIRED"),
        (task(tool_profile=ToolProfile.BOUNDED_WRITE), "WRITE_PROFILE_NOT_ENABLED"),
        (task(route=ExecutionRoute.SIMPLE_LLM, model_profile="simple-llm-v1"), "TOOL_PROFILE_INVALID"),
        (task(model_profile="unapproved-v1"), "MODEL_PROFILE_UNAPPROVED"),
        (task(guard_policy_version="task-guard-v0"), "POLICY_VERSION_STALE"),
    ],
)
def test_guard_fails_closed(value: DepartmentTask, code: str) -> None:
    with pytest.raises(TaskGuardRejection, match=code):
        validate(value)
