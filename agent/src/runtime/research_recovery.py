"""Restore queued Research context from durable references, never from caller text."""

# ruff: noqa: E501

from collections.abc import Collection
from datetime import UTC, datetime
from typing import Literal, Protocol
from uuid import UUID

from pydantic import Field

from contracts import AgentRunRequest, AgentRunStatus, AgentRunView, StrictModel
from security import DelegationTokenVerifier, TokenVerificationError

from .research_budget import PostgresResearchBudgetLedger
from .research_dispatch import InMemoryResearchDispatchContextBroker, ResearchEventPublisher
from .research_input import research_input_digest
from .task_contracts import AttemptStatus, DepartmentTask, TaskAttempt, TaskStatus
from .task_guard import TaskGuard
from .task_shadow import ResearchFifoPilot


class ResearchRecoveryRequest(StrictModel):
    task_id: UUID
    task_revision: int = Field(ge=1)
    attempt_id: UUID
    authorization_revision: int = Field(ge=1)
    budget_revision: int = Field(ge=1)


class ResearchRecoveryResponse(StrictModel):
    task_id: UUID
    task_revision: int
    attempt_id: UUID
    status: Literal["STAGED", "REPLAY_ONLY"]
    published_events: int


class RecoveryRunStore(Protocol):
    async def get_request(self, run_id: UUID) -> AgentRunRequest: ...

    async def get(self, run_id: UUID) -> AgentRunView: ...


class RecoveryTaskRegistry(Protocol):
    async def get_task(self, task_id: UUID, revision: int, workspace_id: UUID) -> DepartmentTask: ...

    async def get_attempt(self, attempt_id: UUID, workspace_id: UUID) -> TaskAttempt: ...


class ResearchRecoveryService:
    def __init__(self, runs: RecoveryRunStore, registry: RecoveryTaskRegistry, broker: InMemoryResearchDispatchContextBroker, dispatcher: ResearchFifoPilot, publisher: ResearchEventPublisher, verifier: DelegationTokenVerifier, workspace_allowlist: Collection[UUID], budget_ledger: PostgresResearchBudgetLedger | None = None) -> None:
        self._runs = runs
        self._registry = registry
        self._broker = broker
        self._dispatcher = dispatcher
        self._publisher = publisher
        self._verifier = verifier
        self._workspaces = frozenset(workspace_allowlist)
        self._budget_ledger = budget_ledger

    async def replay(self, run_id: UUID, body: ResearchRecoveryRequest, workload_token: str) -> ResearchRecoveryResponse:
        principal = self._verifier.verify(workload_token)
        self._verifier.authorize_run(principal, run_id=run_id, permission="agent.task.report")
        if principal.workspace_id not in self._workspaces:
            raise TokenVerificationError("Research report workspace is not enabled")
        request = await self._runs.get_request(run_id)
        task = await self._registry.get_task(body.task_id, body.task_revision, principal.workspace_id)
        attempt = await self._registry.get_attempt(body.attempt_id, principal.workspace_id)
        if request.context.initiated_by != principal.initiated_by or request.context.project_id != principal.project_id or request.context.workspace_id != principal.workspace_id or task.run_id != run_id or task.workspace_id != principal.workspace_id or task.project_id != principal.project_id or attempt.task_id != task.task_id or attempt.task_revision != task.revision or attempt.run_id != run_id:
            raise TokenVerificationError("Research report reference exceeds authority")
        # Report-only tokens can drain telemetry after membership revocation, never stage executable context.
        await self._broker.discard(attempt.attempt_id)
        published = await self._publisher.publish_once(workload_token, workspace_id=principal.workspace_id, run_id=run_id)
        return ResearchRecoveryResponse(task_id=task.task_id, task_revision=task.revision, attempt_id=attempt.attempt_id, status="REPLAY_ONLY", published_events=published)

    async def restore(self, run_id: UUID, body: ResearchRecoveryRequest, workload_token: str) -> ResearchRecoveryResponse:
        principal = self._verifier.verify(workload_token)
        self._verifier.authorize_run(principal, run_id=run_id, permission="agent.task.recover")
        if principal.workspace_id not in self._workspaces:
            raise TokenVerificationError("Research recovery workspace is not enabled")
        request = await self._runs.get_request(run_id)
        context = request.context
        if context.run_id != run_id or context.workspace_id != principal.workspace_id or context.project_id != principal.project_id or context.initiated_by != principal.initiated_by:
            raise TokenVerificationError("Research recovery exceeds delegated authority")
        task = await self._registry.get_task(body.task_id, body.task_revision, principal.workspace_id)
        attempt = await self._registry.get_attempt(body.attempt_id, principal.workspace_id)
        if task.run_id != run_id or task.project_id != context.project_id or task.execution.specialist_profile != "research-read-v1" or attempt.task_id != task.task_id or attempt.task_revision != task.revision or attempt.run_id != run_id or attempt.workspace_id != task.workspace_id:
            raise ValueError("Research recovery reference conflicts with durable state")
        TaskGuard().validate(task, current_permissions=principal.permissions, current_authorization_revision=body.authorization_revision, current_budget_revision=body.budget_revision, parent_budget=request.budget)
        view = await self._runs.get(run_id)
        status: Literal["STAGED", "REPLAY_ONLY"] = "REPLAY_ONLY"
        # This endpoint does not reset a lease, change lifecycle state, or rerun a started attempt.
        if task.status is TaskStatus.QUEUED and attempt.status is AttemptStatus.QUEUED and view.status not in {AgentRunStatus.CANCELLED, AgentRunStatus.FAILED}:
            if self._budget_ledger is not None:
                await self._budget_ledger.require_shadow(task, request)
            if task.execution.input_sha256 != research_input_digest(request):
                raise ValueError("Research input reference is missing or has changed; re-admission is required")
            await self._dispatcher.observe_queued(task, attempt, self._dispatcher.capacity(datetime.now(UTC)))
            await self._broker.stage(request, task, attempt, workload_token)
            status = "STAGED"
        published = await self._publisher.publish_once(workload_token, workspace_id=task.workspace_id, run_id=run_id)
        return ResearchRecoveryResponse(task_id=task.task_id, task_revision=task.revision, attempt_id=attempt.attempt_id, status=status, published_events=published)
