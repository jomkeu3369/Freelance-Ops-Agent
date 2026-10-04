"""State machine for asynchronous Agent runs and HITL resume commands."""

from __future__ import annotations

import asyncio
import logging
import traceback
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol
from uuid import UUID

from contracts import (
    AgentInterruption,
    AgentRunAccepted,
    AgentRunEvent,
    AgentRunMetadata,
    AgentRunRequest,
    AgentRunResult,
    AgentRunStatus,
    AgentRunUsage,
    AgentRunView,
    ClarificationAnswer,
    DepartmentName,
    RequestTier,
    ResumeAgentRunRequest,
)
from platform_budget import PlatformBudgetError, PlatformSpendLedger, current_ledger, platform_budget_scope

from .task_contracts import AttemptStatus

logger = logging.getLogger(__name__)


class AgentRunNotFoundError(LookupError):
    pass


class AgentRunStateError(RuntimeError):
    pass


class AgentExecutionError(RuntimeError):
    def __init__(self, code: str, usage: AgentRunUsage | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.usage = usage


@dataclass(frozen=True, slots=True)
class ExecutionAuthorization:
    delegation_token: str = field(repr=False)
    traceparent: str | None = None

    def __post_init__(self) -> None:
        if not self.delegation_token.strip():
            raise ValueError("delegation token is required")


@dataclass(frozen=True, slots=True)
class ExecutionEvent:
    type: str
    data: dict[str, object] = field(default_factory=dict)


_progress_publisher: ContextVar[Callable[[ExecutionEvent], Awaitable[None]] | None] = ContextVar(
    "agent_run_progress_publisher", default=None
)


async def publish_progress(event: ExecutionEvent) -> None:
    """Persist a genuine in-flight event before the next specialist starts."""
    publisher = _progress_publisher.get()
    if publisher is not None:
        await publisher(event)


@dataclass(frozen=True, slots=True)
class ExecutionOutcome:
    result: AgentRunResult | None = None
    interruption: AgentInterruption | None = None
    active_department: DepartmentName | None = None
    usage: AgentRunUsage | None = None
    events: tuple[ExecutionEvent, ...] = ()
    partial_error_code: str | None = None

    def __post_init__(self) -> None:
        if (self.result is None) == (self.interruption is None):
            raise ValueError("execution outcome requires exactly one of result or interruption")
        if self.partial_error_code is not None and self.result is None:
            raise ValueError("partial execution outcome requires a result")


class AgentRunExecutor(Protocol):
    async def execute(self, request: AgentRunRequest, resume: ResumeAgentRunRequest | None = None, authorization: ExecutionAuthorization | None = None) -> ExecutionOutcome: ...  # noqa: E501


class TaskTerminalObserver(Protocol):
    async def observe_terminal(self, request: AgentRunRequest, target: AttemptStatus, failure_code: str | None, workload_token: str) -> bool: ...  # noqa: E501


class RunCheckpointJournal(Protocol):
    async def record(self, request: AgentRunRequest, status: AgentRunStatus, phase: str, *, active_department: DepartmentName | None = None, error_code: str | None = None) -> None: ...  # noqa: E501

    async def execute(self, executor: AgentRunExecutor, request: AgentRunRequest, resume: ResumeAgentRunRequest | None, authorization: ExecutionAuthorization | None) -> ExecutionOutcome: ...  # noqa: E501


class NullCheckpointJournal:
    async def record(self, request: AgentRunRequest, status: AgentRunStatus, phase: str, *, active_department: DepartmentName | None = None, error_code: str | None = None) -> None:  # noqa: E501
        del request, status, phase, active_department, error_code

    async def execute(self, executor: AgentRunExecutor, request: AgentRunRequest, resume: ResumeAgentRunRequest | None, authorization: ExecutionAuthorization | None) -> ExecutionOutcome:  # noqa: E501
        return await executor.execute(request, resume, authorization)


@dataclass(slots=True)
class _RunRecord:
    request: AgentRunRequest
    status: AgentRunStatus
    updated_at: datetime
    active_department: DepartmentName | None = None
    interruption: AgentInterruption | None = None
    result: AgentRunResult | None = None
    error_code: str | None = None
    usage: AgentRunUsage | None = None
    idempotency_keys: set[str] = field(default_factory=set)
    events: list[AgentRunEvent] = field(default_factory=list)

    def view(self) -> AgentRunView:
        return AgentRunView(
            run_id=self.request.context.run_id,
            status=self.status,
            active_department=self.active_department,
            interruption=self.interruption,
            result=self.result,
            error_code=self.error_code,
            metadata=_metadata(self.request),
            usage=self.usage,
            updated_at=self.updated_at,
        )


class AgentRunStore(Protocol):
    @property
    def supports_platform_reservations(self) -> bool: ...

    async def create(self, request: AgentRunRequest) -> AgentRunView: ...

    async def get(self, run_id: UUID) -> AgentRunView: ...

    async def get_request(self, run_id: UUID) -> AgentRunRequest: ...

    async def mark_running(self, run_id: UUID, request: AgentRunRequest | None = None) -> AgentRunView: ...

    async def complete(self, run_id: UUID, outcome: ExecutionOutcome) -> None: ...

    async def fail(self, run_id: UUID, error_code: str, usage: AgentRunUsage | None = None) -> None: ...

    async def cancel(self, run_id: UUID, usage: AgentRunUsage | None = None) -> None: ...

    async def list_events(self, run_id: UUID, after_event_id: int = 0) -> list[AgentRunEvent]: ...

    async def append_progress(self, run_id: UUID, event: ExecutionEvent) -> None: ...

    async def list_route_events(self, run_id: UUID, after_event_id: int = 0, limit: int = 101) -> list[AgentRunEvent]: ...  # noqa: E501

    async def prepare_resume(self, run_id: UUID, command: ResumeAgentRunRequest) -> AgentRunRequest: ...


class InMemoryAgentRunStore:
    """Development store behind a protocol; PostgreSQL replaces it for deployment."""

    supports_platform_reservations = False

    def __init__(self) -> None:
        self._records: dict[UUID, _RunRecord] = {}
        self._lock = asyncio.Lock()

    async def create(self, request: AgentRunRequest) -> AgentRunView:
        async with self._lock:
            run_id = request.context.run_id
            if run_id in self._records:
                existing = self._records[run_id]
                if existing.request != request:
                    raise AgentRunStateError("agent run already exists with a different request")
                return existing.view()
            now = datetime.now(UTC)
            record = _RunRecord(request=request, status=AgentRunStatus.QUEUED, updated_at=now)
            self._append_event(record, "run.accepted")
            self._records[run_id] = record
            return record.view()

    async def get(self, run_id: UUID) -> AgentRunView:
        async with self._lock:
            return self._record(run_id).view()

    async def get_request(self, run_id: UUID) -> AgentRunRequest:
        async with self._lock:
            return self._record(run_id).request

    async def mark_running(self, run_id: UUID, request: AgentRunRequest | None = None) -> AgentRunView:
        async with self._lock:
            record = self._record(run_id)
            if record.status is not AgentRunStatus.QUEUED or (request is not None and request != record.request):
                raise AgentRunStateError("agent run cannot enter RUNNING from its current state")
            record.status = AgentRunStatus.RUNNING
            record.interruption = None
            record.updated_at = datetime.now(UTC)
            self._append_event(record, "run.started")
            return record.view()

    async def complete(self, run_id: UUID, outcome: ExecutionOutcome) -> None:
        async with self._lock:
            record = self._record(run_id)
            if record.status is not AgentRunStatus.RUNNING:
                raise AgentRunStateError("only a running Agent run can complete or interrupt")
            record.active_department = outcome.active_department
            record.result = outcome.result
            record.interruption = outcome.interruption
            record.usage = merge_usage(record.usage, outcome.usage)
            record.status = (
                AgentRunStatus.WAITING_FOR_USER
                if outcome.interruption is not None
                else AgentRunStatus.PARTIAL
                if outcome.partial_error_code is not None
                else AgentRunStatus.COMPLETED
            )
            record.error_code = outcome.partial_error_code
            record.updated_at = datetime.now(UTC)
            for event in outcome.events:
                self._append_event(record, event.type, event.data)
            if outcome.interruption is not None:
                self._append_event(
                    record,
                    "clarification.requested",
                    {"kind": outcome.interruption.kind.value},
                )
            elif outcome.partial_error_code is not None:
                self._append_event(record, "run.partial", {"errorCode": outcome.partial_error_code})
            else:
                self._append_event(record, "run.completed")

    async def fail(self, run_id: UUID, error_code: str, usage: AgentRunUsage | None = None) -> None:
        async with self._lock:
            record = self._record(run_id)
            # Terminal results are final: a later checkpoint/logging failure must not refund completed work.
            if record.status in {
                AgentRunStatus.COMPLETED, AgentRunStatus.PARTIAL, AgentRunStatus.FAILED, AgentRunStatus.CANCELLED,
            }:
                return
            record.status = AgentRunStatus.FAILED
            record.error_code = error_code
            record.usage = merge_usage(record.usage, usage)
            record.updated_at = datetime.now(UTC)
            self._append_event(record, "run.failed", {"errorCode": error_code})

    async def cancel(self, run_id: UUID, usage: AgentRunUsage | None = None) -> None:
        async with self._lock:
            record = self._record(run_id)
            if record.status in {
                AgentRunStatus.COMPLETED,
                AgentRunStatus.PARTIAL,
                AgentRunStatus.FAILED,
                AgentRunStatus.CANCELLED,
            }:
                raise AgentRunStateError("terminal Agent run cannot be cancelled")
            record.status = AgentRunStatus.CANCELLED
            record.usage = merge_usage(record.usage, usage)
            record.updated_at = datetime.now(UTC)
            self._append_event(record, "run.cancelled")

    async def list_events(self, run_id: UUID, after_event_id: int = 0) -> list[AgentRunEvent]:
        async with self._lock:
            record = self._record(run_id)
            return [event for event in record.events if event.event_id > after_event_id]

    async def append_progress(self, run_id: UUID, event: ExecutionEvent) -> None:
        async with self._lock:
            record = self._record(run_id)
            if record.status is not AgentRunStatus.RUNNING:
                raise AgentRunStateError("only a running Agent run can publish progress")
            self._append_event(record, event.type, event.data)

    async def list_route_events(self, run_id: UUID, after_event_id: int = 0, limit: int = 101) -> list[AgentRunEvent]:
        if not 1 <= limit <= 101:
            raise ValueError("route event limit must be between 1 and 101")
        async with self._lock:
            events = [
                event for event in self._record(run_id).events
                if event.event_id > after_event_id and event.type == "route.selected"
            ]
            return events[:limit]

    async def prepare_resume(self, run_id: UUID, command: ResumeAgentRunRequest) -> AgentRunRequest:
        async with self._lock:
            record = self._record(run_id)
            if record.status is not AgentRunStatus.WAITING_FOR_USER or record.interruption is None:
                raise AgentRunStateError("agent run is not waiting for user input")
            if record.interruption.interruption_id != command.interruption_id:
                raise AgentRunStateError("interruption id does not match the active interruption")
            if command.idempotency_key in record.idempotency_keys:
                raise AgentRunStateError("resume idempotency key was already used")
            question_count = len(record.interruption.questions)
            indices = [answer.question_index for answer in command.answers]
            if len(indices) != len(set(indices)) or any(index >= question_count for index in indices):
                raise AgentRunStateError("resume answers do not match active questions")
            record.idempotency_keys.add(command.idempotency_key)
            record.request = append_clarification_history(record.request, record.interruption, command)
            record.status = AgentRunStatus.QUEUED
            record.interruption = None
            record.updated_at = datetime.now(UTC)
            self._append_event(record, "clarification.responded")
            return record.request

    @staticmethod
    def _append_event(record: _RunRecord, event_type: str, data: dict[str, object] | None = None) -> None:
        record.events.append(
            AgentRunEvent(
                event_id=len(record.events) + 1,
                run_id=record.request.context.run_id,
                type=event_type,
                occurred_at=datetime.now(UTC),
                data=data or {},
            )
        )

    def _record(self, run_id: UUID) -> _RunRecord:
        try:
            return self._records[run_id]
        except KeyError as error:
            raise AgentRunNotFoundError("agent run was not found") from error


def _metadata(request: AgentRunRequest) -> AgentRunMetadata:
    return AgentRunMetadata(
        pet_profiles=request.input.pet_profiles,
        credential_id=request.model_selection.credential_id,
        provider=request.model_selection.provider,
        model=request.model_selection.model,
        prompt_version="department-work-product-v3-personal-pets",
        tool_schema_version="spring-tool-api-v0.3.0",
        trace_id=request.context.trace_id,
    )


def append_clarification_history(request: AgentRunRequest, interruption: AgentInterruption, command: ResumeAgentRunRequest) -> AgentRunRequest:  # noqa: E501
    additions = [
        ClarificationAnswer(
            question=interruption.questions[answer.question_index],
            answer=answer.answer
        )
        for answer in sorted(command.answers, key=lambda item: item.question_index)
    ]
    return request.model_copy(
        update={"clarification_history": [*request.clarification_history, *additions]}
    )


def merge_usage(current: AgentRunUsage | None, incoming: AgentRunUsage | None) -> AgentRunUsage | None:
    if incoming is None:
        return current
    if current is None:
        return incoming
    if (current.platform_reservation_id is not None and incoming.platform_reservation_id is not None
            and current.platform_reservation_id != incoming.platform_reservation_id):
        raise PlatformBudgetError("PLATFORM_RESERVATION_MISMATCH")
    if (current.tariff_version is not None and incoming.tariff_version is not None
            and current.tariff_version != incoming.tariff_version):
        raise PlatformBudgetError("PLATFORM_TARIFF_MISMATCH")
    # A journal failure after persisting an interruption can report this segment
    # twice. Attempt IDs make monetary settlement idempotent in that path too.
    calls = {call.call_id: call for call in current.provider_calls}
    for call in incoming.provider_calls:
        calls.setdefault(call.call_id, call)
    protected = current.platform_reservation_id is not None or incoming.platform_reservation_id is not None
    tier_order = {
        RequestTier.DIRECT_TOOL: 0,
        RequestTier.SINGLE_AGENT: 1,
        RequestTier.DEPARTMENT: 2,
        RequestTier.MULTI_DEPARTMENT: 3,
        RequestTier.HUMAN_REQUIRED: 4
    }
    request_tier = max((current.request_tier, incoming.request_tier), key=tier_order.__getitem__)
    return AgentRunUsage(
        request_tier=request_tier,
        model_calls=len(calls) if protected else current.model_calls + incoming.model_calls,
        tool_calls=current.tool_calls + incoming.tool_calls,
        input_tokens=sum(call.input_tokens for call in calls.values()) if protected else current.input_tokens + incoming.input_tokens,  # noqa: E501
        output_tokens=sum(call.output_tokens for call in calls.values()) if protected else current.output_tokens + incoming.output_tokens,  # noqa: E501
        cached_tokens=sum(call.cached_read_tokens for call in calls.values()) if protected else current.cached_tokens + incoming.cached_tokens,  # noqa: E501
        search_credits=current.search_credits + incoming.search_credits,
        crawled_pages=current.crawled_pages + incoming.crawled_pages,
        retry_count=current.retry_count + incoming.retry_count,
        duration_ms=current.duration_ms + incoming.duration_ms,
        provider_calls=list(calls.values()),
        platform_cost_usd=sum((call.cost_usd for call in calls.values()), current.platform_cost_usd * 0) if protected else current.platform_cost_usd + incoming.platform_cost_usd,  # noqa: E501
        platform_reservation_id=incoming.platform_reservation_id or current.platform_reservation_id,
        tariff_version=incoming.tariff_version or current.tariff_version,
    )


class RunCoordinator:
    def __init__(self, store: AgentRunStore, executor: AgentRunExecutor, checkpoint_journal: RunCheckpointJournal | None = None, task_terminal_observer: TaskTerminalObserver | None = None, *, require_platform_budget: bool = False, allow_memory_platform_budget_for_tests: bool = False) -> None:  # noqa: E501
        self._store = store
        self._executor = executor
        self._checkpoint_journal = checkpoint_journal or NullCheckpointJournal()
        self._task_terminal_observer = task_terminal_observer
        self._active_tasks: dict[UUID, asyncio.Task[None]] = {}
        self._task_lock = asyncio.Lock()
        self._require_platform_budget = require_platform_budget
        # Constructor-only offline mock seam. Never expose as a setting or request field.
        self._allow_memory_platform_budget_for_tests = allow_memory_platform_budget_for_tests
        self._active_ledgers: dict[UUID, PlatformSpendLedger] = {}

    async def accept(self, request: AgentRunRequest) -> AgentRunAccepted:
        if request.platform_budget is None and self._require_platform_budget:
            raise PlatformBudgetError("PLATFORM_BUDGET_REQUIRED")
        if request.platform_budget is not None:
            self._require_durable_budget_store()
            if request.platform_budget.reservation_id != request.context.run_id:
                raise PlatformBudgetError("PLATFORM_RESERVATION_MISMATCH")
            PlatformSpendLedger(request.platform_budget).validate()
        view = await self._store.create(request)
        await self._checkpoint_journal.record(request, AgentRunStatus.QUEUED, "accepted")
        return AgentRunAccepted(
            run_id=request.context.run_id,
            status=AgentRunStatus.QUEUED,
            accepted_at=view.updated_at,
        )

    def _require_durable_budget_store(self) -> None:
        if (self._store.supports_platform_reservations is not True
                and not self._allow_memory_platform_budget_for_tests):
            # A process restart erases a memory store's spent/RUNNING record.
            # Replaying the same backend reservation would then reset its cap.
            raise PlatformBudgetError("PLATFORM_DURABLE_STORE_REQUIRED")

    async def execute(self, request: AgentRunRequest, authorization: ExecutionAuthorization | None = None) -> None:
        await self._tracked_run(request, None, authorization)

    async def view(self, run_id: UUID) -> AgentRunView:
        return await self._store.get(run_id)

    async def events(self, run_id: UUID, after_event_id: int = 0) -> list[AgentRunEvent]:
        return await self._store.list_events(run_id, after_event_id)

    async def route_events(self, run_id: UUID, after_event_id: int = 0, limit: int = 101) -> list[AgentRunEvent]:
        return await self._store.list_route_events(run_id, after_event_id, limit)

    async def cancel(self, run_id: UUID) -> None:
        request = await self._store.get_request(run_id)
        ledger = self._active_ledgers.get(run_id)
        if ledger is not None:
            # Freeze admission before persisting cancellation, including attempts
            # whose HTTP response is still pending or lost.
            ledger.blocked = True
            await self._store.cancel(run_id, ledger.report(None))
        else:
            await self._store.cancel(run_id)
        async with self._task_lock:
            task = self._active_tasks.get(run_id)
            if task is not None and task is not asyncio.current_task():
                task.cancel()
        await self._checkpoint_journal.record(request, AgentRunStatus.CANCELLED, "cancelled")

    async def accept_resume(self, run_id: UUID, command: ResumeAgentRunRequest) -> tuple[AgentRunAccepted, AgentRunRequest]:  # noqa: E501
        request = await self._store.prepare_resume(run_id, command)
        return (
            AgentRunAccepted(
                run_id=run_id,
                status=AgentRunStatus.QUEUED,
                accepted_at=datetime.now(UTC),
            ),
            request,
        )

    async def resume(self, request: AgentRunRequest, command: ResumeAgentRunRequest, authorization: ExecutionAuthorization | None = None) -> None:  # noqa: E501
        await self._tracked_run(request, command, authorization)

    async def _tracked_run(self, request: AgentRunRequest, resume: ResumeAgentRunRequest | None, authorization: ExecutionAuthorization | None) -> None:  # noqa: E501
        run_id = request.context.run_id
        task = asyncio.current_task()
        if task is None:
            await self._run(request, resume, authorization)
            return
        async with self._task_lock:
            active = self._active_tasks.get(run_id)
            if active is not None and active is not task and not active.done():
                return
            self._active_tasks[run_id] = task
        try:
            await self._run(request, resume, authorization)
        finally:
            async with self._task_lock:
                if self._active_tasks.get(run_id) is task:
                    self._active_tasks.pop(run_id, None)

    async def _run(self, request: AgentRunRequest, resume: ResumeAgentRunRequest | None, authorization: ExecutionAuthorization | None) -> None:  # noqa: E501
        if request.platform_budget is not None:
            try:
                self._require_durable_budget_store()
            except PlatformBudgetError as error:
                await self._store.fail(request.context.run_id, error.code)
                return
        try:
            previous = await self._store.mark_running(request.context.run_id, request)
        except AgentRunStateError:
            logger.info("Agent run claim was superseded: run_id=%s", request.context.run_id)
            return
        ledger = None
        if request.platform_budget is not None:
            try:
                if request.platform_budget.reservation_id != request.context.run_id:
                    raise PlatformBudgetError("PLATFORM_RESERVATION_MISMATCH")
                ledger = PlatformSpendLedger(request.platform_budget, previous.usage, request.budget)
            except PlatformBudgetError as error:
                await self._store.fail(request.context.run_id, error.code)
                return
            self._active_ledgers[request.context.run_id] = ledger
        try:
            with platform_budget_scope(ledger):
                await self._run_scoped(request, resume, authorization)
        finally:
            self._active_ledgers.pop(request.context.run_id, None)

    async def _run_scoped(self, request: AgentRunRequest, resume: ResumeAgentRunRequest | None, authorization: ExecutionAuthorization | None) -> None:  # noqa: E501
        run_id = request.context.run_id
        ledger = current_ledger()

        def report(usage: AgentRunUsage | None = None) -> AgentRunUsage | None:
            return ledger.report(usage) if ledger is not None else usage

        try:
            if ledger is not None:
                ledger.validate()
            elif self._require_platform_budget:
                raise PlatformBudgetError("PLATFORM_BUDGET_REQUIRED")
            await self._checkpoint_journal.record(request, AgentRunStatus.RUNNING, "execution_started")
            async def record_progress(event: ExecutionEvent) -> None:
                await self._store.append_progress(run_id, event)

            progress_token = _progress_publisher.set(record_progress)
            try:
                outcome = await asyncio.wait_for(
                    self._checkpoint_journal.execute(self._executor, request, resume, authorization),
                    timeout=request.budget.max_duration_seconds,
                )
            finally:
                _progress_publisher.reset(progress_token)
            outcome = replace(outcome, usage=report(outcome.usage))
            await self._store.complete(run_id, outcome)
            status = (
                AgentRunStatus.WAITING_FOR_USER
                if outcome.interruption is not None
                else AgentRunStatus.PARTIAL
                if outcome.partial_error_code is not None
                else AgentRunStatus.COMPLETED
            )
            phase = (
                "interrupted"
                if outcome.interruption is not None
                else "execution_partially_completed"
                if outcome.partial_error_code is not None
                else "execution_completed"
            )
            try:
                await self._checkpoint_journal.record(
                    request,
                    status,
                    phase,
                    active_department=outcome.active_department,
                    error_code=outcome.partial_error_code,
                )
            except Exception:
                if outcome.interruption is not None:
                    raise
                # The durable run result already committed. Keep terminal accounting and task observation final.
                logger.error("Terminal checkpoint journal failed after result commit: run_id=%s", run_id)
            if outcome.interruption is None:
                research_completed = outcome.result is not None and any(result.department is DepartmentName.RESEARCH for result in outcome.result.department_results)  # noqa: E501
                target = AttemptStatus.COMPLETED if outcome.partial_error_code is None or research_completed else AttemptStatus.FAILED  # noqa: E501
                await self._observe_terminal(request, target, None if target is AttemptStatus.COMPLETED else outcome.partial_error_code, authorization)  # noqa: E501
        except TimeoutError:
            await self._store.fail(run_id, "RUN_TIMEOUT", report())
            await self._checkpoint_journal.record(
                request,
                AgentRunStatus.FAILED,
                "execution_failed",
                error_code="RUN_TIMEOUT",
            )
            await self._observe_terminal(request, AttemptStatus.FAILED, "RUN_TIMEOUT", authorization)
        except (AgentExecutionError, PlatformBudgetError) as error:
            await self._store.fail(run_id, error.code, report(getattr(error, "usage", None)))
            await self._checkpoint_journal.record(
                request,
                AgentRunStatus.FAILED,
                "execution_failed",
                error_code=error.code,
            )
            await self._observe_terminal(request, AttemptStatus.FAILED, error.code, authorization)
        except AgentRunStateError:
            logger.info("Agent run transition was already claimed or superseded: run_id=%s", run_id)
        except Exception as error:
            frames = [
                {"file": Path(frame.filename).name, "line": frame.lineno, "function": frame.name}
                for frame in traceback.extract_tb(error.__traceback__)
            ]
            logger.error(
                "Unhandled Agent execution error: run_id=%s error_type=%s frames=%s",
                run_id,
                error.__class__.__name__,
                frames,
            )
            await self._store.fail(run_id, "AGENT_EXECUTION_FAILED", report())
            await self._checkpoint_journal.record(
                request,
                AgentRunStatus.FAILED,
                "execution_failed",
                error_code="AGENT_EXECUTION_FAILED",
            )
            await self._observe_terminal(request, AttemptStatus.FAILED, "AGENT_EXECUTION_FAILED", authorization)

    async def _observe_terminal(self, request: AgentRunRequest, target: AttemptStatus, failure_code: str | None, authorization: ExecutionAuthorization | None) -> None:  # noqa: E501
        if self._task_terminal_observer is None or authorization is None:
            return
        try:
            await self._task_terminal_observer.observe_terminal(request, target, failure_code, authorization.delegation_token)  # noqa: E501
        except (OSError, RuntimeError, TypeError, ValueError) as error:
            logger.warning("Research Task terminal observation deferred: error_type=%s", error.__class__.__name__)
