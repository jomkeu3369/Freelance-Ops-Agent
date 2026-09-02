"""Dispatcher sink and current-state result fence for the Research pilot."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import logging
from collections.abc import Collection
from dataclasses import dataclass, field, replace
from typing import Protocol
from uuid import UUID

from contracts import AgentRunRequest, RunBudget

from .research_specialist import ResearchSpecialistError
from .research_worker import ResearchTaskWorker
from .task_contracts import AttemptStatus, DepartmentTask, TaskAttempt, TaskStatus
from .task_registry import AttemptNotFoundError, PostgresTaskRegistry, TaskNotFoundError
from .task_scheduler_store import ClaimedSchedulerEntry

logger = logging.getLogger(__name__)


class PostgresResearchResultFence:
    def __init__(self, registry: PostgresTaskRegistry) -> None:
        self._registry = registry

    async def allows(self, task: DepartmentTask, attempt: TaskAttempt) -> bool:
        try:
            current_task = await self._registry.get_task(task.task_id, task.revision, task.workspace_id)
            current_attempt = await self._registry.get_attempt(attempt.attempt_id, attempt.workspace_id)
        except (TaskNotFoundError, AttemptNotFoundError):
            return False
        return current_task.status is TaskStatus.RUNNING and current_attempt.status is AttemptStatus.RUNNING and current_attempt.task_id == current_task.task_id and current_attempt.task_revision == current_task.revision and current_attempt.attempt_number == attempt.attempt_number


@dataclass(frozen=True, slots=True)
class ResearchDispatchContext:
    task: DepartmentTask
    attempt: TaskAttempt
    objective: str
    jurisdiction: str | None
    current_permissions: Collection[str]
    current_authorization_revision: int
    current_budget_revision: int
    parent_budget: RunBudget
    workload_token: str = field(repr=False)


class ResearchDispatchContextLoader(Protocol):
    async def load(self, claim: ClaimedSchedulerEntry) -> ResearchDispatchContext | None: ...

    async def discard(self, attempt_id: UUID) -> None: ...


class ResearchEventPublisher(Protocol):
    async def publish_once(self, workload_token: str, *, batch_size: int = 100) -> int: ...


class InMemoryResearchDispatchContextBroker:
    def __init__(self) -> None:
        self._contexts: dict[UUID, ResearchDispatchContext] = {}
        self._lock = asyncio.Lock()

    async def stage(self, request: AgentRunRequest, task: DepartmentTask, attempt: TaskAttempt, workload_token: str) -> None:
        context = ResearchDispatchContext(task, attempt, request.input.requirement_text, None, tuple(task.execution.permissions), task.execution.authorization_revision, task.execution.budget_revision, request.budget, workload_token)
        async with self._lock:
            existing = self._contexts.get(attempt.attempt_id)
            if existing is not None and replace(existing, workload_token=workload_token) != context:
                raise ValueError("Research dispatch context conflicts with existing attempt")
            self._contexts[attempt.attempt_id] = context

    async def load(self, claim: ClaimedSchedulerEntry) -> ResearchDispatchContext | None:
        async with self._lock:
            return self._contexts.get(claim.candidate.attempt_id)

    async def discard(self, attempt_id: UUID) -> None:
        async with self._lock:
            self._contexts.pop(attempt_id, None)


class ResearchWorkerDispatchSink:
    def __init__(self, worker: ResearchTaskWorker, loader: ResearchDispatchContextLoader, publisher: ResearchEventPublisher | None = None) -> None:
        self._worker = worker
        self._loader = loader
        self._publisher = publisher
        self._tasks: set[asyncio.Task[None]] = set()

    async def dispatch(self, claim: ClaimedSchedulerEntry) -> bool:
        context = await self._loader.load(claim)
        if context is None or not self._matches(claim, context):
            return False
        try:
            self._worker.validate(context.task, context.attempt, current_permissions=context.current_permissions, current_authorization_revision=context.current_authorization_revision, current_budget_revision=context.current_budget_revision, parent_budget=context.parent_budget)
        except (ResearchSpecialistError, RuntimeError, ValueError) as error:
            logger.warning("Research FIFO dispatch rejected: error_type=%s", error.__class__.__name__)
            return False
        task = asyncio.create_task(self._run(context), name=f"research-attempt-{context.attempt.attempt_id}")
        self._tasks.add(task)
        task.add_done_callback(self._completed)
        return True

    async def wait(self) -> None:
        if self._tasks:
            await asyncio.gather(*tuple(self._tasks), return_exceptions=True)

    async def _run(self, context: ResearchDispatchContext) -> None:
        try:
            await self._worker.run(context.task, context.attempt, objective=context.objective, jurisdiction=context.jurisdiction, current_permissions=context.current_permissions, current_authorization_revision=context.current_authorization_revision, current_budget_revision=context.current_budget_revision, parent_budget=context.parent_budget)
        finally:
            if self._publisher is not None:
                try:
                    await self._publisher.publish_once(context.workload_token)
                except (OSError, RuntimeError, TypeError, ValueError) as error:
                    logger.warning("Research Task event publication deferred: error_type=%s", error.__class__.__name__)
            await self._loader.discard(context.attempt.attempt_id)

    def _completed(self, task: asyncio.Task[None]) -> None:
        self._tasks.discard(task)
        try:
            task.result()
        except asyncio.CancelledError:
            logger.info("Research FIFO worker was cancelled")
        except (ResearchSpecialistError, RuntimeError, ValueError) as error:
            logger.warning("Research FIFO worker finished without merge: error_type=%s", error.__class__.__name__)

    @staticmethod
    def _matches(claim: ClaimedSchedulerEntry, context: ResearchDispatchContext) -> bool:
        candidate = claim.candidate
        task = context.task
        attempt = context.attempt
        return task.execution.specialist_profile == "research-read-v1" and task.status is TaskStatus.QUEUED and attempt.status is AttemptStatus.QUEUED and candidate.task_id == task.task_id and candidate.task_revision == task.revision and candidate.workspace_id == task.workspace_id and candidate.attempt_id == attempt.attempt_id and attempt.task_id == task.task_id and attempt.task_revision == task.revision and attempt.run_id == task.run_id and attempt.workspace_id == task.workspace_id
