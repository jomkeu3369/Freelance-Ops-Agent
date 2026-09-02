"""Shadow-only Research Task registration across Spring and Python registries."""

# ruff: noqa: E501, I001

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID, uuid5

from contracts import AgentRunRequest, DepartmentName
from integrations.task_registration import SpringTaskRegistration, SpringTaskRegistrationClient
from routing import FinalRouteDecision, RouteExecutionProfile, SafetyContext, execution_profile

from .task_contracts import AttemptStatus, DepartmentTask, ExecutionRoute, TaskAttempt, TaskExecutionSnapshot, TaskStatus
from .task_registry import AttemptNotFoundError, PostgresTaskRegistry, TaskNotFoundError


@dataclass(frozen=True, slots=True)
class TaskShadowHandle:
    task: DepartmentTask
    attempt: TaskAttempt


class ResearchTaskShadowRegistrar(Protocol):
    async def register(self, request: AgentRunRequest, decision: FinalRouteDecision, safety: SafetyContext, workload_token: str) -> TaskShadowHandle: ...  # noqa: E501


class PostgresResearchTaskShadowRegistrar:
    def __init__(self, registry: PostgresTaskRegistry, spring: SpringTaskRegistrationClient) -> None:
        self._registry = registry
        self._spring = spring

    async def register(self, request: AgentRunRequest, decision: FinalRouteDecision, safety: SafetyContext, workload_token: str) -> TaskShadowHandle:
        task_id = uuid5(request.context.run_id, "research-read-v1:task:1")
        attempt_id = uuid5(task_id, "attempt:1")
        permissions = _read_only_permissions(request.context.effective_permissions)
        route_profile = execution_profile(decision.route, safety)
        payload = _payload(request, task_id, attempt_id, permissions, route_profile)
        registered = await self._spring.register(payload, workload_token)
        _require_identity(registered, request, task_id, attempt_id)
        created_at = registered.attempt.queued_at.astimezone(UTC)
        execution = TaskExecutionSnapshot(route=ExecutionRoute(decision.route.value), permissions=permissions, budget=request.budget, model_selection=request.model_selection, policy_version="task-guard-v1", prompt_version="research-v1", tool_schema_version="web-research-v1", risk_level=route_profile.risk, tool_profile=route_profile.tool_profile, model_profile=route_profile.model_profile, route_profile_version=route_profile.policy_version, guard_policy_version="task-guard-v1", specialist_profile="research-read-v1", authorization_revision=registered.authorization_revision, budget_revision=registered.budget_revision)
        task = DepartmentTask(task_id=task_id, run_id=request.context.run_id, workspace_id=request.context.workspace_id, project_id=request.context.project_id, department=DepartmentName.RESEARCH, revision=registered.task.revision, priority=3, execution=execution, created_at=created_at)
        attempt = TaskAttempt(attempt_id=attempt_id, task_id=task_id, run_id=request.context.run_id, workspace_id=request.context.workspace_id, task_revision=task.revision, attempt_number=registered.attempt.attempt_number)
        task = await self._ensure_task(task)
        attempt = await self._ensure_attempt(attempt, created_at)
        return TaskShadowHandle(task, attempt)

    async def _ensure_task(self, proposed: DepartmentTask) -> DepartmentTask:
        try:
            task = await self._registry.get_task(proposed.task_id, proposed.revision, proposed.workspace_id)
        except TaskNotFoundError:
            task = await self._registry.create_task(proposed)
        if task.status is TaskStatus.SUBMITTED:
            task = await self._registry.transition_task(task.task_id, task.revision, task.workspace_id, TaskStatus.ADMITTED)
        if task.status is TaskStatus.ADMITTED:
            task = await self._registry.transition_task(task.task_id, task.revision, task.workspace_id, TaskStatus.QUEUED)
        return task

    async def _ensure_attempt(self, proposed: TaskAttempt, queued_at: datetime) -> TaskAttempt:
        try:
            attempt = await self._registry.get_attempt(proposed.attempt_id, proposed.workspace_id)
        except AttemptNotFoundError:
            attempt = await self._registry.create_attempt(proposed)
        if attempt.status is AttemptStatus.PREDICTED:
            attempt = await self._registry.transition_attempt(attempt.attempt_id, attempt.workspace_id, AttemptStatus.QUEUED, queued_at=queued_at)
        return attempt


def _read_only_permissions(values: Collection[str]) -> list[str]:
    permissions = sorted({value for value in values if value == "agent.run" or value.endswith(".read")})
    if "agent.run" not in permissions or "project.read" not in permissions:
        raise ValueError("Research Task shadow requires agent.run and project.read")
    return permissions


def _payload(request: AgentRunRequest, task_id: UUID, attempt_id: UUID, permissions: list[str], route_profile: RouteExecutionProfile) -> dict[str, object]:
    return {"taskId": str(task_id), "attemptId": str(attempt_id), "parentTaskId": None, "department": "RESEARCH", "specialistProfile": "research-read-v1", "alias": "Research #1", "objectiveReference": f"run:{request.context.run_id}:research:1", "priority": 3, "deadlineAt": None, "dependencyTaskIds": [], "predictedServiceRuntimeSeconds": None, "predictionModelVersion": None, "predictionFeatureSnapshot": {}, "executionProfile": {"route": route_profile.route.value, "riskLevel": route_profile.risk.value, "modelProfile": route_profile.model_profile, "toolProfile": route_profile.tool_profile.value, "provider": request.model_selection.provider.value, "model": request.model_selection.model, "reasoningEffort": request.model_selection.reasoning_effort.value, "permissions": permissions, "budget": request.budget.model_dump(mode="json", by_alias=True), "routeProfileVersion": route_profile.policy_version, "guardPolicyVersion": "task-guard-v1"}}


def _require_identity(registered: SpringTaskRegistration, request: AgentRunRequest, task_id: UUID, attempt_id: UUID) -> None:
    invalid = registered.task.task_id != task_id or registered.task.workspace_id != request.context.workspace_id or registered.task.run_id != request.context.run_id or registered.task.revision != registered.attempt.task_revision or registered.task.current_attempt_number != registered.attempt.attempt_number or registered.attempt.task_id != task_id or registered.attempt.attempt_id != attempt_id
    if invalid:
        raise ValueError("Spring Task registration identity does not match the requested workload")
