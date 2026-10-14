"""개발과 테스트용 메모리 실행 상태 저장소."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

from contracts import (
    AgentInterruption,
    AgentRunEvent,
    AgentRunRequest,
    AgentRunResult,
    AgentRunStatus,
    AgentRunUsage,
    AgentRunView,
    DepartmentName,
    RequestTier,
    ResumeAgentRunRequest,
)
from platform_budget import PlatformSpendLedger

from .run_contracts import AgentRunNotFoundError, AgentRunStateError, ExecutionEvent, ExecutionOutcome
from .run_state import append_clarification_history, merge_usage, run_metadata


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
            metadata=run_metadata(self.request),
            usage=self.usage,
            updated_at=self.updated_at
        )


class InMemoryAgentRunStore:
    """개발용 메모리 저장소. 배포에서는 같은 계약의 PostgreSQL 저장소를 사용한다."""

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
            if record.usage is not None:
                record.usage = record.usage.model_copy(update={"execution_closed": False})
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
                self._append_event(record, "clarification.requested", {"kind": outcome.interruption.kind.value})
            elif outcome.partial_error_code is not None:
                self._append_event(record, "run.partial", {"errorCode": outcome.partial_error_code})
            else:
                self._append_event(record, "run.completed")

    async def fail(self, run_id: UUID, error_code: str, usage: AgentRunUsage | None = None) -> None:
        async with self._lock:
            record = self._record(run_id)
            # 완료된 결과는 확정 상태다. 이후 체크포인트나 로그 실패로 사용량을 환급하지 않는다.
            if record.status in {
                AgentRunStatus.COMPLETED,
                AgentRunStatus.PARTIAL,
                AgentRunStatus.FAILED,
                AgentRunStatus.CANCELLED,
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
            if record.status is AgentRunStatus.QUEUED and record.request.platform_budget is not None:
                idle = PlatformSpendLedger(record.request.platform_budget, record.usage)
                idle.closed = True
                usage = idle.report(None)
            if record.status is AgentRunStatus.QUEUED and record.request.byok_budget is not None:
                usage = AgentRunUsage(
                    request_tier=RequestTier.SINGLE_AGENT,
                    model_calls=0,
                    tool_calls=0,
                    input_tokens=0,
                    output_tokens=0,
                    duration_ms=0,
                    execution_closed=True,
                    byok_scope_id=record.request.byok_budget.scope_id
                )
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

    async def record_usage(self, run_id: UUID, usage: AgentRunUsage) -> None:
        async with self._lock:
            record = self._record(run_id)
            record.usage = merge_usage(record.usage, usage)
            record.updated_at = datetime.now(UTC)

    async def list_route_events(self, run_id: UUID, after_event_id: int = 0, limit: int = 101) -> list[AgentRunEvent]:
        if not 1 <= limit <= 101:
            raise ValueError("route event limit must be between 1 and 101")
        async with self._lock:
            events = [
                event
                for event in self._record(run_id).events
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
                data=data or {}
            )
        )

    def _record(self, run_id: UUID) -> _RunRecord:
        try:
            return self._records[run_id]
        except KeyError as error:
            raise AgentRunNotFoundError("agent run was not found") from error
