"""실행 상태와 인증 정보, 저장소와 실행기의 공통 계약."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol
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
    ResumeAgentRunRequest,
)

from .task_contracts import AttemptStatus


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

    async def record_usage(self, run_id: UUID, usage: AgentRunUsage) -> None: ...

    async def list_route_events(self, run_id: UUID, after_event_id: int = 0, limit: int = 101) -> list[AgentRunEvent]: ...  # noqa: E501

    async def prepare_resume(self, run_id: UUID, command: ResumeAgentRunRequest) -> AgentRunRequest: ...
