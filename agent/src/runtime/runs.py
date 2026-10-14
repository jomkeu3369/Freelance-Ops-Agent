"""실행의 접수와 재개, 취소, 예산 정산을 조정한다."""

from __future__ import annotations

import asyncio
import logging
import traceback
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from byok_budget import ByokExecutionLedger, byok_budget_scope, current_byok_ledger
from contracts import (
    AgentRunAccepted,
    AgentRunEvent,
    AgentRunRequest,
    AgentRunStatus,
    AgentRunUsage,
    AgentRunView,
    DepartmentName,
    ResumeAgentRunRequest,
)
from platform_budget import PlatformBudgetError, PlatformSpendLedger, current_ledger, platform_budget_scope

from .run_contracts import (
    AgentExecutionError,
    AgentRunExecutor,
    AgentRunStateError,
    AgentRunStore,
    ExecutionAuthorization,
    ExecutionEvent,
    NullCheckpointJournal,
    RunCheckpointJournal,
    TaskTerminalObserver,
)
from .run_progress import progress_scope
from .task_contracts import AttemptStatus

logger = logging.getLogger(__name__)


class RunCoordinator:
    def __init__(self, store: AgentRunStore, executor: AgentRunExecutor, checkpoint_journal: RunCheckpointJournal | None = None, task_terminal_observer: TaskTerminalObserver | None = None, *, require_platform_budget: bool = False, allow_memory_platform_budget_for_tests: bool = False) -> None:  # noqa: E501
        self._store = store
        self._executor = executor
        self._checkpoint_journal = checkpoint_journal or NullCheckpointJournal()
        self._task_terminal_observer = task_terminal_observer
        self._active_tasks: dict[UUID, asyncio.Task[None]] = {}
        self._task_lock = asyncio.Lock()
        self._require_platform_budget = require_platform_budget
        # 오프라인 모의 테스트에서 생성자로만 사용한다. 설정이나 요청 필드로 노출하지 않는다.
        self._allow_memory_platform_budget_for_tests = allow_memory_platform_budget_for_tests
        self._active_ledgers: dict[UUID, PlatformSpendLedger | ByokExecutionLedger] = {}

    async def accept(self, request: AgentRunRequest) -> AgentRunAccepted:
        self._validate_funding(request)
        if request.platform_budget is not None:
            self._require_durable_budget_store()
            if request.platform_budget.reservation_id != request.context.run_id:
                raise PlatformBudgetError("PLATFORM_RESERVATION_MISMATCH")
            PlatformSpendLedger(request.platform_budget).validate()
        view = await self._store.create(request)
        await self._checkpoint_journal.record(request, AgentRunStatus.QUEUED, "accepted")
        return AgentRunAccepted(
            run_id=request.context.run_id, status=AgentRunStatus.QUEUED, accepted_at=view.updated_at
        )

    def _validate_funding(self, request: AgentRunRequest) -> None:
        if request.byok_budget is not None:
            self._require_durable_budget_store()
            ByokExecutionLedger(request).validate()
        elif request.model_selection.credential_id is not None and (
            self._require_platform_budget or request.platform_budget is not None
        ):
            raise PlatformBudgetError("BYOK_BUDGET_REQUIRED")
        elif request.platform_budget is None and self._require_platform_budget:
            raise PlatformBudgetError("PLATFORM_BUDGET_REQUIRED")

    def _require_durable_budget_store(self) -> None:
        if self._store.supports_platform_reservations is not True and not self._allow_memory_platform_budget_for_tests:
            # 프로세스가 재시작되면 메모리 저장소의 사용량과 실행 상태가 사라진다.
            # 같은 백엔드 예약을 다시 실행하면 상한이 초기화되므로 허용하지 않는다.
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
            # 취소 상태를 저장하기 전에 새 승인을 차단한다.
            # HTTP 응답이 대기 중이거나 유실된 시도도 포함한다.
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
        self._validate_funding(await self._store.get_request(run_id))
        request = await self._store.prepare_resume(run_id, command)
        return (AgentRunAccepted(run_id=run_id, status=AgentRunStatus.QUEUED, accepted_at=datetime.now(UTC)), request)

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
        try:
            self._validate_funding(request)
            if request.platform_budget is not None:
                self._require_durable_budget_store()
        except PlatformBudgetError as error:
            await self._store.fail(request.context.run_id, error.code)
            return
        try:
            previous = await self._store.mark_running(request.context.run_id, request)
        except AgentRunStateError:
            logger.info("Agent run claim was superseded: run_id=%s", request.context.run_id)
            return
        ledger: PlatformSpendLedger | ByokExecutionLedger | None = None
        if request.byok_budget is not None:
            try:
                ledger = ByokExecutionLedger(
                    request, previous.usage, authorization.delegation_token if authorization else None
                )
            except PlatformBudgetError as error:
                await self._store.fail(request.context.run_id, error.code)
                return
        elif request.platform_budget is not None:
            try:
                if request.platform_budget.reservation_id != request.context.run_id:
                    raise PlatformBudgetError("PLATFORM_RESERVATION_MISMATCH")
                ledger = PlatformSpendLedger(request.platform_budget, previous.usage, request.budget)
            except PlatformBudgetError as error:
                await self._store.fail(request.context.run_id, error.code)
                return
        if ledger is not None:
            self._active_ledgers[request.context.run_id] = ledger

            async def persist_usage(usage: AgentRunUsage) -> None:
                await self._store.record_usage(request.context.run_id, usage)

            ledger.persist_usage = persist_usage
        try:
            with (
                platform_budget_scope(ledger if isinstance(ledger, PlatformSpendLedger) else None),
                byok_budget_scope(ledger if isinstance(ledger, ByokExecutionLedger) else None),
            ):
                await self._run_scoped(request, resume, authorization)
        finally:
            self._active_ledgers.pop(request.context.run_id, None)
            if ledger is not None:
                # 실행 범위가 닫히면 늦게 도착하거나 분리된 호출을 차단한다.
                # Spring은 이 정보와 종료 상태로 사용하지 않은 예약만 해제한다.
                await self._store.record_usage(request.context.run_id, ledger.report(None))

    async def _run_scoped(self, request: AgentRunRequest, resume: ResumeAgentRunRequest | None, authorization: ExecutionAuthorization | None) -> None:  # noqa: E501
        run_id = request.context.run_id
        ledger: PlatformSpendLedger | ByokExecutionLedger | None = current_byok_ledger() or current_ledger()

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

            with progress_scope(record_progress):
                outcome = await asyncio.wait_for(
                    self._checkpoint_journal.execute(self._executor, request, resume, authorization),
                    timeout=min(request.budget.max_duration_seconds, ledger.remaining_seconds())
                    if isinstance(ledger, ByokExecutionLedger)
                    else request.budget.max_duration_seconds
                )
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
                    error_code=outcome.partial_error_code
                )
            except Exception:
                if outcome.interruption is not None:
                    raise
                # 결과는 이미 영속 저장됐다. 종료된 사용량과 작업 관측 결과를 유지한다.
                logger.error("Terminal checkpoint journal failed after result commit: run_id=%s", run_id)
            if outcome.interruption is None:
                research_completed = outcome.result is not None and any(
                    result.department is DepartmentName.RESEARCH for result in outcome.result.department_results
                )
                target = (
                    AttemptStatus.COMPLETED
                    if outcome.partial_error_code is None or research_completed
                    else AttemptStatus.FAILED
                )
                await self._observe_terminal(
                    request,
                    target,
                    None if target is AttemptStatus.COMPLETED else outcome.partial_error_code,
                    authorization
                )
        except TimeoutError:
            await self._store.fail(run_id, "RUN_TIMEOUT", report())
            await self._checkpoint_journal.record(
                request, AgentRunStatus.FAILED, "execution_failed", error_code="RUN_TIMEOUT"
            )
            await self._observe_terminal(request, AttemptStatus.FAILED, "RUN_TIMEOUT", authorization)
        except (AgentExecutionError, PlatformBudgetError) as error:
            await self._store.fail(run_id, error.code, report(getattr(error, "usage", None)))
            await self._checkpoint_journal.record(
                request, AgentRunStatus.FAILED, "execution_failed", error_code=error.code
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
                frames
            )
            await self._store.fail(run_id, "AGENT_EXECUTION_FAILED", report())
            await self._checkpoint_journal.record(
                request, AgentRunStatus.FAILED, "execution_failed", error_code="AGENT_EXECUTION_FAILED"
            )
            await self._observe_terminal(request, AttemptStatus.FAILED, "AGENT_EXECUTION_FAILED", authorization)

    async def _observe_terminal(self, request: AgentRunRequest, target: AttemptStatus, failure_code: str | None, authorization: ExecutionAuthorization | None) -> None:  # noqa: E501
        if self._task_terminal_observer is None or authorization is None:
            return
        try:
            await self._task_terminal_observer.observe_terminal(
                request, target, failure_code, authorization.delegation_token
            )
        except (OSError, RuntimeError, TypeError, ValueError) as error:
            logger.warning("Research Task terminal observation deferred: error_type=%s", error.__class__.__name__)
