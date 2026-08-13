"""State machine for asynchronous Agent runs and HITL resume commands."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime
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
    AgentRunView,
    DepartmentName,
    ResumeAgentRunRequest,
)


class AgentRunNotFoundError(LookupError):
    pass


class AgentRunStateError(RuntimeError):
    pass


class AgentExecutionError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class ExecutionAuthorization:
    delegation_token: str = field(repr=False)
    traceparent: str | None = None

    def __post_init__(self) -> None:
        if not self.delegation_token.strip():
            raise ValueError("delegation token is required")


@dataclass(frozen=True, slots=True)
class ExecutionOutcome:
    result: AgentRunResult | None = None
    interruption: AgentInterruption | None = None
    active_department: DepartmentName | None = None

    def __post_init__(self) -> None:
        if (self.result is None) == (self.interruption is None):
            raise ValueError("execution outcome requires exactly one of result or interruption")


class AgentRunExecutor(Protocol):
    async def execute(self, request: AgentRunRequest, resume: ResumeAgentRunRequest | None = None, authorization: ExecutionAuthorization | None = None) -> ExecutionOutcome: ...  # noqa: E501


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
            updated_at=self.updated_at,
        )


class AgentRunStore(Protocol):
    async def create(self, request: AgentRunRequest) -> AgentRunView: ...

    async def get(self, run_id: UUID) -> AgentRunView: ...

    async def get_request(self, run_id: UUID) -> AgentRunRequest: ...

    async def mark_running(self, run_id: UUID) -> None: ...

    async def complete(self, run_id: UUID, outcome: ExecutionOutcome) -> None: ...

    async def fail(self, run_id: UUID, error_code: str) -> None: ...

    async def cancel(self, run_id: UUID) -> None: ...

    async def list_events(self, run_id: UUID, after_event_id: int = 0) -> list[AgentRunEvent]: ...

    async def prepare_resume(self, run_id: UUID, command: ResumeAgentRunRequest) -> AgentRunRequest: ...


class InMemoryAgentRunStore:
    """Development store behind a protocol; PostgreSQL replaces it for deployment."""

    def __init__(self) -> None:
        self._records: dict[UUID, _RunRecord] = {}
        self._lock = asyncio.Lock()

    async def create(self, request: AgentRunRequest) -> AgentRunView:
        async with self._lock:
            run_id = request.context.run_id
            if run_id in self._records:
                raise AgentRunStateError("agent run already exists")
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

    async def mark_running(self, run_id: UUID) -> None:
        async with self._lock:
            record = self._record(run_id)
            if record.status not in {AgentRunStatus.QUEUED, AgentRunStatus.WAITING_FOR_USER}:
                raise AgentRunStateError("agent run cannot enter RUNNING from its current state")
            record.status = AgentRunStatus.RUNNING
            record.interruption = None
            record.updated_at = datetime.now(UTC)
            self._append_event(record, "run.started")

    async def complete(self, run_id: UUID, outcome: ExecutionOutcome) -> None:
        async with self._lock:
            record = self._record(run_id)
            if record.status is not AgentRunStatus.RUNNING:
                raise AgentRunStateError("only a running Agent run can complete or interrupt")
            record.active_department = outcome.active_department
            record.result = outcome.result
            record.interruption = outcome.interruption
            record.status = (
                AgentRunStatus.WAITING_FOR_USER
                if outcome.interruption is not None
                else AgentRunStatus.COMPLETED
            )
            record.updated_at = datetime.now(UTC)
            if outcome.interruption is not None:
                self._append_event(
                    record,
                    "clarification.requested",
                    {"kind": outcome.interruption.kind.value},
                )
            else:
                self._append_event(record, "run.completed")

    async def fail(self, run_id: UUID, error_code: str) -> None:
        async with self._lock:
            record = self._record(run_id)
            if record.status is AgentRunStatus.CANCELLED:
                return
            record.status = AgentRunStatus.FAILED
            record.error_code = error_code
            record.updated_at = datetime.now(UTC)
            self._append_event(record, "run.failed", {"errorCode": error_code})

    async def cancel(self, run_id: UUID) -> None:
        async with self._lock:
            record = self._record(run_id)
            if record.status in {
                AgentRunStatus.COMPLETED,
                AgentRunStatus.FAILED,
                AgentRunStatus.CANCELLED,
            }:
                raise AgentRunStateError("terminal Agent run cannot be cancelled")
            record.status = AgentRunStatus.CANCELLED
            record.updated_at = datetime.now(UTC)
            self._append_event(record, "run.cancelled")

    async def list_events(self, run_id: UUID, after_event_id: int = 0) -> list[AgentRunEvent]:
        async with self._lock:
            record = self._record(run_id)
            return [event for event in record.events if event.event_id > after_event_id]

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
        provider=request.model_selection.provider,
        model=request.model_selection.model,
        prompt_version="department-work-product-v1",
        tool_schema_version="spring-tool-api-v0.1.0",
        trace_id=request.context.trace_id,
    )


class RunCoordinator:
    def __init__(self, store: AgentRunStore, executor: AgentRunExecutor, checkpoint_journal: RunCheckpointJournal | None = None) -> None:  # noqa: E501
        self._store = store
        self._executor = executor
        self._checkpoint_journal = checkpoint_journal or NullCheckpointJournal()
        self._active_tasks: dict[UUID, asyncio.Task[None]] = {}
        self._task_lock = asyncio.Lock()

    async def accept(self, request: AgentRunRequest) -> AgentRunAccepted:
        view = await self._store.create(request)
        await self._checkpoint_journal.record(request, AgentRunStatus.QUEUED, "accepted")
        return AgentRunAccepted(
            run_id=request.context.run_id,
            status=AgentRunStatus.QUEUED,
            accepted_at=view.updated_at,
        )

    async def execute(self, request: AgentRunRequest, authorization: ExecutionAuthorization | None = None) -> None:
        await self._tracked_run(request, None, authorization)

    async def view(self, run_id: UUID) -> AgentRunView:
        return await self._store.get(run_id)

    async def events(self, run_id: UUID, after_event_id: int = 0) -> list[AgentRunEvent]:
        return await self._store.list_events(run_id, after_event_id)

    async def cancel(self, run_id: UUID) -> None:
        request = await self._store.get_request(run_id)
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
            self._active_tasks[run_id] = task
        try:
            await self._run(request, resume, authorization)
        finally:
            async with self._task_lock:
                if self._active_tasks.get(run_id) is task:
                    self._active_tasks.pop(run_id, None)

    async def _run(self, request: AgentRunRequest, resume: ResumeAgentRunRequest | None, authorization: ExecutionAuthorization | None) -> None:  # noqa: E501
        run_id = request.context.run_id
        try:
            await self._store.mark_running(run_id)
            await self._checkpoint_journal.record(request, AgentRunStatus.RUNNING, "execution_started")
            outcome = await asyncio.wait_for(
                self._checkpoint_journal.execute(self._executor, request, resume, authorization),
                timeout=request.budget.max_duration_seconds,
            )
            await self._store.complete(run_id, outcome)
            status = AgentRunStatus.WAITING_FOR_USER if outcome.interruption is not None else AgentRunStatus.COMPLETED
            phase = "interrupted" if outcome.interruption is not None else "execution_completed"
            await self._checkpoint_journal.record(
                request,
                status,
                phase,
                active_department=outcome.active_department,
            )
        except TimeoutError:
            await self._store.fail(run_id, "RUN_TIMEOUT")
            await self._checkpoint_journal.record(
                request,
                AgentRunStatus.FAILED,
                "execution_failed",
                error_code="RUN_TIMEOUT",
            )
        except AgentExecutionError as error:
            await self._store.fail(run_id, error.code)
            await self._checkpoint_journal.record(
                request,
                AgentRunStatus.FAILED,
                "execution_failed",
                error_code=error.code,
            )
        except Exception:
            await self._store.fail(run_id, "AGENT_EXECUTION_FAILED")
            await self._checkpoint_journal.record(
                request,
                AgentRunStatus.FAILED,
                "execution_failed",
                error_code="AGENT_EXECUTION_FAILED",
            )
