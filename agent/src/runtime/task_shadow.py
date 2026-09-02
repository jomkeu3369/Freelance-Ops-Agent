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

from .task_attempt_events import TaskAttemptEventWrite
from .task_contracts import AttemptStatus, DepartmentTask, ExecutionRoute, TaskAttempt, TaskExecutionSnapshot, TaskStatus
from .scheduler import WorkerCapacitySnapshot
from .task_registry import AttemptNotFoundError, PostgresTaskRegistry, TaskNotFoundError


@dataclass(frozen=True, slots=True)
class TaskShadowHandle:
    task: DepartmentTask
    attempt: TaskAttempt


class ResearchTaskShadowRegistrar(Protocol):
    async def register(self, request: AgentRunRequest, decision: FinalRouteDecision, safety: SafetyContext, workload_token: str) -> TaskShadowHandle: ...  # noqa: E501


class TaskShadowPublisher(Protocol):
    async def publish_once(self, workload_token: str, *, batch_size: int = 100) -> int: ...


class ResearchFifoPilot(Protocol):
    @property
    def prediction(self) -> tuple[float, str]: ...

    def capacity(self, captured_at: datetime) -> WorkerCapacitySnapshot: ...

    async def observe_queued(self, task: DepartmentTask, attempt: TaskAttempt, capacity: WorkerCapacitySnapshot) -> object: ...

    async def dispatch_once(self, *, now: datetime | None = None) -> object: ...


class ResearchDispatchBroker(Protocol):
    async def stage(self, request: AgentRunRequest, task: DepartmentTask, attempt: TaskAttempt, workload_token: str) -> None: ...


class PostgresResearchTaskShadowRegistrar:
    SOURCE = "agent-run-shadow-v1"

    def __init__(self, registry: PostgresTaskRegistry, spring: SpringTaskRegistrationClient, publisher: TaskShadowPublisher | None = None, dispatcher: ResearchFifoPilot | None = None, context_broker: ResearchDispatchBroker | None = None) -> None:
        if (dispatcher is None) != (context_broker is None):
            raise ValueError("Research FIFO dispatcher and context broker must be configured together")
        self._registry = registry
        self._spring = spring
        self._publisher = publisher
        self._dispatcher = dispatcher
        self._context_broker = context_broker

    async def register(self, request: AgentRunRequest, decision: FinalRouteDecision, safety: SafetyContext, workload_token: str) -> TaskShadowHandle:
        task_id, attempt_id = _identities(request.context.run_id)
        permissions = _read_only_permissions(request.context.effective_permissions)
        route_profile = execution_profile(decision.route, safety)
        prediction = (None, None) if self._dispatcher is None else self._dispatcher.prediction
        payload = _payload(request, task_id, attempt_id, permissions, route_profile, *prediction)
        registered = await self._spring.register(payload, workload_token)
        _require_identity(registered, request, task_id, attempt_id)
        created_at = registered.attempt.queued_at.astimezone(UTC)
        execution = TaskExecutionSnapshot(route=ExecutionRoute(decision.route.value), permissions=permissions, budget=request.budget, model_selection=request.model_selection, policy_version="task-guard-v1", prompt_version="research-v1", tool_schema_version="web-research-v1", risk_level=route_profile.risk, tool_profile=route_profile.tool_profile, model_profile=route_profile.model_profile, route_profile_version=route_profile.policy_version, guard_policy_version="task-guard-v1", specialist_profile="research-read-v1", authorization_revision=registered.authorization_revision, budget_revision=registered.budget_revision)
        task = DepartmentTask(task_id=task_id, run_id=request.context.run_id, workspace_id=request.context.workspace_id, project_id=request.context.project_id, department=DepartmentName.RESEARCH, revision=registered.task.revision, priority=3, execution=execution, created_at=created_at)
        attempt = TaskAttempt(attempt_id=attempt_id, task_id=task_id, run_id=request.context.run_id, workspace_id=request.context.workspace_id, task_revision=task.revision, attempt_number=registered.attempt.attempt_number, predicted_service_runtime_seconds=prediction[0], predictor_version=prediction[1])
        task = await self._ensure_task(task)
        attempt = await self._ensure_attempt(attempt, created_at)
        if self._dispatcher is not None and self._context_broker is not None:
            if task.status is TaskStatus.QUEUED and attempt.status is AttemptStatus.QUEUED:
                await self._context_broker.stage(request, task, attempt, workload_token)
                await self._dispatcher.observe_queued(task, attempt, self._dispatcher.capacity(created_at))
                await self._dispatcher.dispatch_once(now=created_at)
            return TaskShadowHandle(task, attempt)
        task, attempt = await self._ensure_started(task, attempt)
        await self._publish(workload_token)
        return TaskShadowHandle(task, attempt)

    async def observe_terminal(self, request: AgentRunRequest, target: AttemptStatus, failure_code: str | None, workload_token: str) -> bool:
        if target not in {AttemptStatus.COMPLETED, AttemptStatus.FAILED}:
            raise ValueError("Research Task shadow terminal status is unsupported")
        task_id, attempt_id = _identities(request.context.run_id)
        try:
            task = await self._registry.get_task(task_id, 1, request.context.workspace_id)
            attempt = await self._registry.get_attempt(attempt_id, request.context.workspace_id)
        except (TaskNotFoundError, AttemptNotFoundError):
            return False
        task, attempt = await self._ensure_started(task, attempt)
        if attempt.status is AttemptStatus.RUNNING:
            occurred_at = datetime.now(UTC)
            event_type = "attempt.completed" if target is AttemptStatus.COMPLETED else "attempt.failed"
            data: dict[str, object] = {}
            if target is AttemptStatus.FAILED:
                data["task_terminal"] = True
                if failure_code is not None:
                    data["failure_code"] = failure_code
            attempt = await self._registry.transition_attempt(attempt.attempt_id, attempt.workspace_id, target, finished_at=occurred_at, event=self._event(task, attempt, 2, event_type, occurred_at, "VERIFICATION", "Research shadow observation completed", data))
        task_target = TaskStatus.COMPLETED if target is AttemptStatus.COMPLETED else TaskStatus.FAILED
        if task.status is TaskStatus.RUNNING:
            await self._registry.transition_task(task.task_id, task.revision, task.workspace_id, task_target)
        await self._publish(workload_token)
        return attempt.status is target

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

    async def _ensure_started(self, task: DepartmentTask, attempt: TaskAttempt) -> tuple[DepartmentTask, TaskAttempt]:
        if attempt.status is AttemptStatus.QUEUED:
            started_at = datetime.now(UTC)
            attempt = await self._registry.transition_attempt(attempt.attempt_id, attempt.workspace_id, AttemptStatus.RUNNING, started_at=started_at, event=self._event(task, attempt, 1, "attempt.started", started_at, "RESEARCH", "Research shadow execution started", {}))
        if task.status is TaskStatus.QUEUED:
            task = await self._registry.transition_task(task.task_id, task.revision, task.workspace_id, TaskStatus.RUNNING)
        return task, attempt

    async def _publish(self, workload_token: str) -> None:
        if self._publisher is not None:
            await self._publisher.publish_once(workload_token)

    @classmethod
    def _event(cls, task: DepartmentTask, attempt: TaskAttempt, sequence: int, event_type: str, occurred_at: datetime, phase: str, milestone: str, data: dict[str, object]) -> TaskAttemptEventWrite:
        event_id = f"{attempt.attempt_id}:{sequence}:{event_type}"
        return TaskAttemptEventWrite(event_id=event_id, run_id=task.run_id, source=cls.SOURCE, source_event_id=event_id, task_id=task.task_id, task_revision=task.revision, attempt_id=attempt.attempt_id, attempt_number=attempt.attempt_number, workspace_id=task.workspace_id, sequence=sequence, event_type=event_type, phase=phase, milestone=milestone, occurred_at=occurred_at, data=data)


def _read_only_permissions(values: Collection[str]) -> list[str]:
    permissions = sorted({value for value in values if value == "agent.run" or value.endswith(".read")})
    if "agent.run" not in permissions or "project.read" not in permissions:
        raise ValueError("Research Task shadow requires agent.run and project.read")
    return permissions


def _identities(run_id: UUID) -> tuple[UUID, UUID]:
    task_id = uuid5(run_id, "research-read-v1:task:1")
    return task_id, uuid5(task_id, "attempt:1")


def _payload(request: AgentRunRequest, task_id: UUID, attempt_id: UUID, permissions: list[str], route_profile: RouteExecutionProfile, predicted_runtime_seconds: float | None = None, predictor_version: str | None = None) -> dict[str, object]:
    return {"taskId": str(task_id), "attemptId": str(attempt_id), "parentTaskId": None, "department": "RESEARCH", "specialistProfile": "research-read-v1", "alias": "Research #1", "objectiveReference": f"run:{request.context.run_id}:research:1", "priority": 3, "deadlineAt": None, "dependencyTaskIds": [], "predictedServiceRuntimeSeconds": predicted_runtime_seconds, "predictionModelVersion": predictor_version, "predictionFeatureSnapshot": {}, "executionProfile": {"route": route_profile.route.value, "riskLevel": route_profile.risk.value, "modelProfile": route_profile.model_profile, "toolProfile": route_profile.tool_profile.value, "provider": request.model_selection.provider.value, "model": request.model_selection.model, "reasoningEffort": request.model_selection.reasoning_effort.value, "permissions": permissions, "budget": request.budget.model_dump(mode="json", by_alias=True), "routeProfileVersion": route_profile.policy_version, "guardPolicyVersion": "task-guard-v1"}}


def _require_identity(registered: SpringTaskRegistration, request: AgentRunRequest, task_id: UUID, attempt_id: UUID) -> None:
    invalid = registered.task.task_id != task_id or registered.task.workspace_id != request.context.workspace_id or registered.task.run_id != request.context.run_id or registered.task.revision != registered.attempt.task_revision or registered.task.current_attempt_number != registered.attempt.attempt_number or registered.attempt.task_id != task_id or registered.attempt.attempt_id != attempt_id
    if invalid:
        raise ValueError("Spring Task registration identity does not match the requested workload")
