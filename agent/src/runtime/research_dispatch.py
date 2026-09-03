"""Dispatcher sink and current-state result fence for the Research pilot."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Collection
from dataclasses import dataclass, field, replace
from typing import Protocol
from uuid import UUID

from contracts import AgentRunRequest, RunBudget
from security import DelegationTokenVerifier, TokenVerificationError

from .research_input import research_input_digest, research_objective
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
    initiated_by: UUID | None = None


class ResearchDispatchContextLoader(Protocol):
    async def load(self, claim: ClaimedSchedulerEntry) -> ResearchDispatchContext | None: ...

    async def discard(self, attempt_id: UUID) -> None: ...


class ResearchEventPublisher(Protocol):
    async def publish_once(self, workload_token: str, *, workspace_id: UUID, run_id: UUID, batch_size: int = 100) -> int: ...


class InMemoryResearchDispatchContextBroker:
    def __init__(self, verifier: DelegationTokenVerifier) -> None:
        self._contexts: dict[UUID, ResearchDispatchContext] = {}
        self._lock = asyncio.Lock()
        self._verifier = verifier

    async def stage(self, request: AgentRunRequest, task: DepartmentTask, attempt: TaskAttempt, workload_token: str) -> None:
        if task.execution.input_sha256 is not None and task.execution.input_sha256 != research_input_digest(request):
            raise ValueError("Research input reference has changed")
        context = ResearchDispatchContext(task, attempt, research_objective(request), request.input.jurisdiction_code, tuple(task.execution.permissions), task.execution.authorization_revision, task.execution.budget_revision, task.execution.budget, workload_token, request.context.initiated_by)
        self._authorize(context)
        async with self._lock:
            existing = self._contexts.get(attempt.attempt_id)
            if existing is not None and replace(existing, workload_token=workload_token) != context:
                raise ValueError("Research dispatch context conflicts with existing attempt")
            self._contexts[attempt.attempt_id] = context

    async def load(self, claim: ClaimedSchedulerEntry) -> ResearchDispatchContext | None:
        async with self._lock:
            context = self._contexts.get(claim.candidate.attempt_id)
            if context is not None:
                try:
                    self._authorize(context)
                except TokenVerificationError:
                    self._contexts.pop(claim.candidate.attempt_id, None)
                    return None
            return context

    async def ready_attempt_ids(self) -> frozenset[UUID]:
        async with self._lock:
            ready = set()
            for attempt_id, context in list(self._contexts.items()):
                try:
                    self._authorize(context)
                    ready.add(attempt_id)
                except TokenVerificationError:
                    self._contexts.pop(attempt_id, None)
            return frozenset(ready)

    def _authorize(self, context: ResearchDispatchContext) -> None:
        principal = self._verifier.verify(context.workload_token)
        task = context.task
        if principal.run_id != task.run_id or principal.workspace_id != task.workspace_id or principal.project_id != task.project_id or principal.initiated_by != context.initiated_by or not set(task.execution.permissions).issubset(principal.permissions):
            raise TokenVerificationError("Research context exceeds delegated authority")

    async def discard(self, attempt_id: UUID) -> None:
        async with self._lock:
            self._contexts.pop(attempt_id, None)


class ResearchWorkerDispatchSink:
    def __init__(self, worker: ResearchTaskWorker, loader: ResearchDispatchContextLoader, publisher: ResearchEventPublisher | None = None, *, worker_count: int = 1, shutdown_timeout_seconds: float = 10) -> None:
        if worker_count < 1 or shutdown_timeout_seconds <= 0:
            raise ValueError("Research worker capacity and shutdown timeout must be positive")
        self._worker = worker
        self._loader = loader
        self._publisher = publisher
        self._tasks: set[asyncio.Task[None]] = set()
        self._worker_count = worker_count
        self._shutdown_timeout_seconds = shutdown_timeout_seconds
        self._reserved: set[UUID] = set()
        self._closing = False
        self._dispatch_once: Callable[[], Awaitable[object]] | None = None
        self._dispatcher_task: asyncio.Task[None] | None = None
        self._recover: Callable[[], Awaitable[int]] | None = None

    def bind_dispatcher(self, dispatch_once: Callable[[], Awaitable[object]], recover: Callable[[], Awaitable[int]] | None = None) -> None:
        self._dispatch_once = dispatch_once
        self._recover = recover

    async def recover(self) -> None:
        if self._recover is not None:
            await self._recover()

    def start(self) -> None:
        if self._dispatch_once is not None and self._dispatcher_task is None and not self._closing:
            self._dispatcher_task = asyncio.create_task(self._dispatch_loop(), name="research-fifo-dispatcher")

    async def _dispatch_loop(self) -> None:
        assert self._dispatch_once is not None
        while not self._closing:
            try:
                await self._dispatch_once()
            except (OSError, RuntimeError, ValueError):
                logger.warning("Research dispatch deferred after a dispatch failure")
            await asyncio.sleep(0.5)

    @property
    def has_capacity(self) -> bool:
        return not self._closing and len(self._reserved) < self._worker_count

    async def dispatch(self, claim: ClaimedSchedulerEntry, *, acknowledge: Callable[[], Awaitable[None]] | None = None) -> bool:
        attempt_id = claim.candidate.attempt_id
        if not self.has_capacity or attempt_id in self._reserved:
            return False
        # Reserve before the first await so concurrent callers cannot oversubscribe this process.
        self._reserved.add(attempt_id)
        scheduled = False
        try:
            context = await self._loader.load(claim)
            if context is None or not self._matches(claim, context):
                return False
            try:
                self._worker.validate(context.task, context.attempt, current_permissions=context.current_permissions, current_authorization_revision=context.current_authorization_revision, current_budget_revision=context.current_budget_revision, parent_budget=context.parent_budget)
            except (ResearchSpecialistError, RuntimeError, ValueError) as error:
                logger.warning("Research FIFO dispatch rejected: error_type=%s", error.__class__.__name__)
                return False
            if self._closing:
                return False
            if acknowledge is not None:
                await acknowledge()
            if self._closing:
                return False
            task = asyncio.create_task(self._run(context, claim), name=f"research-attempt-{context.attempt.attempt_id}")
            self._tasks.add(task)
            task.add_done_callback(lambda completed: self._completed_attempt(completed, attempt_id))
            scheduled = True
            return True
        finally:
            if not scheduled:
                self._reserved.discard(attempt_id)

    async def wait(self) -> None:
        if self._tasks:
            await asyncio.gather(*tuple(self._tasks), return_exceptions=True)

    async def close(self) -> None:
        self._closing = True
        if self._dispatcher_task is not None:
            self._dispatcher_task.cancel()
            await asyncio.gather(self._dispatcher_task, return_exceptions=True)
        tasks = tuple(self._tasks)
        if not tasks:
            return
        _, pending = await asyncio.wait(tasks, timeout=self._shutdown_timeout_seconds)
        for task in pending:
            task.cancel()
        if pending:
            # Cancellation-cooperative providers get a bounded cleanup window.
            _, unfinished = await asyncio.wait(pending, timeout=1)
            if unfinished:
                logger.error("Research workers exceeded cancellation grace: count=%s", len(unfinished))

    async def _run(self, context: ResearchDispatchContext, claim: ClaimedSchedulerEntry) -> None:
        cancelled = False
        try:
            fresh = await self._loader.load(claim)
            if fresh is None or not self._matches(claim, fresh):
                return
            context = fresh
            await self._worker.run(context.task, context.attempt, objective=context.objective, jurisdiction=context.jurisdiction, current_permissions=context.current_permissions, current_authorization_revision=context.current_authorization_revision, current_budget_revision=context.current_budget_revision, parent_budget=context.parent_budget, claim=claim)
        except asyncio.CancelledError:
            cancelled = True
            raise
        finally:
            try:
                if self._publisher is not None and not cancelled:
                    try:
                        await self._publisher.publish_once(context.workload_token, workspace_id=context.task.workspace_id, run_id=context.task.run_id)
                    except (OSError, RuntimeError, TypeError, ValueError) as error:
                        logger.warning("Research Task event publication deferred: error_type=%s", error.__class__.__name__)
            finally:
                await self._loader.discard(context.attempt.attempt_id)

    def _completed_attempt(self, task: asyncio.Task[None], attempt_id: UUID) -> None:
        self._reserved.discard(attempt_id)
        self._completed(task)

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
