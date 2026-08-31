"""Fail-closed Task contract validation before admission or dispatch."""

from __future__ import annotations

from collections.abc import Collection

from contracts import RunBudget
from routing.profiles import ExecutionRisk, ToolProfile

from .task_contracts import DepartmentTask, ExecutionRoute


class TaskGuardRejection(RuntimeError):
    pass


class TaskGuard:
    def validate(
        self,
        task: DepartmentTask,
        *,
        current_permissions: Collection[str],
        current_authorization_revision: int,
        current_budget_revision: int,
        parent_budget: RunBudget,
    ) -> None:
        snapshot = task.execution
        permissions = frozenset(current_permissions)
        requested = frozenset(snapshot.permissions)
        if snapshot.authorization_revision != current_authorization_revision:
            raise TaskGuardRejection("TASK_AUTHORIZATION_REVISION_STALE")
        if snapshot.budget_revision != current_budget_revision:
            raise TaskGuardRejection("TASK_BUDGET_REVISION_STALE")
        if snapshot.guard_policy_version != "task-guard-v1" or snapshot.route_profile_version != "route-profile-v1":
            raise TaskGuardRejection("TASK_POLICY_VERSION_STALE")
        required = {"agent.run", "project.read"}
        if (
            not required.issubset(requested)
            or not required.issubset(permissions)
            or not requested.issubset(permissions)
        ):
            raise TaskGuardRejection("TASK_PERMISSION_DENIED")
        if snapshot.route is ExecutionRoute.HUMAN_REQUIRED or snapshot.risk_level is ExecutionRisk.RESTRICTED:
            raise TaskGuardRejection("TASK_HUMAN_APPROVAL_REQUIRED")
        if snapshot.tool_profile is ToolProfile.BOUNDED_WRITE:
            raise TaskGuardRejection("TASK_WRITE_PROFILE_NOT_ENABLED")
        tool_route = snapshot.route in {
            ExecutionRoute.DIRECT_TOOL,
            ExecutionRoute.REACT_AGENT,
            ExecutionRoute.SUPERVISOR,
        }
        if tool_route != (snapshot.tool_profile is ToolProfile.READ_ONLY):
            raise TaskGuardRejection("TASK_TOOL_PROFILE_INVALID")
        expected_model_profile = {
            ExecutionRoute.DIRECT_TOOL: "direct-tool-v1",
            ExecutionRoute.SIMPLE_LLM: "simple-llm-v1",
            ExecutionRoute.REACT_AGENT: "react-read-v1",
            ExecutionRoute.SUPERVISOR: "supervisor-v1",
            ExecutionRoute.HUMAN_REQUIRED: "human-required",
        }[snapshot.route]
        if snapshot.model_profile != expected_model_profile:
            raise TaskGuardRejection("TASK_MODEL_PROFILE_UNAPPROVED")
        if snapshot.tool_profile is ToolProfile.READ_ONLY and any(
            permission != "agent.run" and not permission.endswith(".read") for permission in requested
        ):
            raise TaskGuardRejection("TASK_PERMISSION_PROFILE_NOT_LEAST_PRIVILEGE")
        if _exceeds(snapshot.budget, parent_budget):
            raise TaskGuardRejection("TASK_BUDGET_EXCEEDED")


def _exceeds(requested: RunBudget, maximum: RunBudget) -> bool:
    fields = (
        "max_duration_seconds", "max_model_calls", "max_tool_calls", "max_input_tokens",
        "max_output_tokens", "max_departments", "max_hierarchy_depth", "max_search_credits",
        "max_retries", "max_handoffs",
    )
    return any(getattr(requested, field) > getattr(maximum, field) for field in fields)
