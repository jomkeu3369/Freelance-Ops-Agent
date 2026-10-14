"""Honest retries and durable interrupted-run evidence without paid replay."""

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from contracts import (
    AgentInput,
    AgentInterruption,
    AgentRunRequest,
    AgentRunResult,
    AgentRunStatus,
    AgentRunUsage,
    ByokBudget,
    DepartmentName,
    DepartmentResult,
    InterruptionKind,
    ModelSelection,
    PlatformBudget,
    Provider,
    ProviderCallUsage,
    RequestTier,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from platform_budget import PlatformBudgetError
from runtime import AgentRunStateError, ExecutionEvent, ExecutionOutcome, InMemoryAgentRunStore, RunCoordinator
from runtime.continuity import INTERRUPTED_RUN_ERROR, INTERRUPTED_RUN_GRACE_SECONDS
from runtime.runs import NullCheckpointJournal


def request() -> AgentRunRequest:
    return AgentRunRequest(
        context=TrustedRunContext(
            run_id=uuid4(), thread_id=uuid4(), trace_id="execution-continuity-test",
            workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(),
            effective_permissions=["agent.run", "agent.respond"],
        ),
        budget=RunBudget(max_duration_seconds=30, max_model_calls=4, max_tool_calls=2,
                         max_input_tokens=1000, max_output_tokens=1000,
                         max_departments=4, max_hierarchy_depth=2),
        model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
        safety_context=SafetyContextInput(), input=AgentInput(requirement_text="Synthetic continuity test"),
    )


@pytest.mark.parametrize("status", [
    AgentRunStatus.RUNNING, AgentRunStatus.WAITING_FOR_USER, AgentRunStatus.COMPLETED,
    AgentRunStatus.PARTIAL, AgentRunStatus.FAILED, AgentRunStatus.CANCELLED,
])
async def test_start_retry_acknowledges_real_state_without_rewriting_checkpoint(status: AgentRunStatus) -> None:
    store = InMemoryAgentRunStore()
    incoming = request()
    run_id = incoming.context.run_id
    await store.create(incoming)
    await store.mark_running(run_id)
    if status is AgentRunStatus.WAITING_FOR_USER:
        await store.complete(run_id, ExecutionOutcome(interruption=AgentInterruption(
            interruption_id=uuid4(), kind=InterruptionKind.CLARIFICATION, questions=["확인 질문"],
        )))
    elif status in {AgentRunStatus.COMPLETED, AgentRunStatus.PARTIAL}:
        await store.complete(run_id, ExecutionOutcome(
            result=AgentRunResult(project_summary="Genuine output"),
            partial_error_code="MODEL_PROVIDER_FAILED" if status is AgentRunStatus.PARTIAL else None,
        ))
    elif status is AgentRunStatus.FAILED:
        await store.fail(run_id, "MODEL_PROVIDER_FAILED")
    elif status is AgentRunStatus.CANCELLED:
        await store.cancel(run_id)
    before = await store.get(run_id)
    events_before = await store.list_events(run_id)
    journal = NullCheckpointJournal()
    journal.record = AsyncMock()  # type: ignore[method-assign]
    executor = AsyncMock()
    coordinator = RunCoordinator(store, executor, journal)

    accepted = await coordinator.accept(incoming)
    await coordinator.execute(incoming)

    assert accepted.status is status
    assert await store.get(run_id) == before
    assert await store.list_events(run_id) == events_before
    journal.record.assert_not_awaited()
    executor.execute.assert_not_awaited()


def usage(run_id, *, known=False) -> AgentRunUsage:
    call = ProviderCallUsage(
        call_id=uuid4(), provider=Provider.OPENAI, model="gpt-test", operation="continuity-test",
        input_tokens=50, output_tokens=20, cost_usd=Decimal("0.02"),
        reserved_cost_usd=Decimal("0.02"), usage_known=known,
    )
    return AgentRunUsage(
        request_tier=RequestTier.SINGLE_AGENT, model_calls=1, tool_calls=0,
        input_tokens=50, output_tokens=20, duration_ms=10, provider_calls=[call],
        platform_cost_usd=call.cost_usd, platform_reservation_id=run_id, tariff_version="test-tariff",
    )


def saved_result() -> AgentRunResult:
    return AgentRunResult(project_summary="Validated requirements", department_results=[
        DepartmentResult(department=DepartmentName.REQUIREMENTS, status="COMPLETED", summary="Genuine first stage"),
    ])


async def save_progress(store, run_id) -> None:
    await store.append_progress(run_id, ExecutionEvent(
        "department.saved", {"department": "REQUIREMENTS", "savedDepartments": 1},
        partial_result=saved_result(), active_department=DepartmentName.REQUIREMENTS,
    ))


def started_at(store, run_id) -> datetime:
    return next(event.occurred_at for event in reversed(store._records[run_id].events) if event.type == "run.started")


async def test_stalled_detection_obeys_execution_deadline_and_preserves_unknown_exposure() -> None:
    store = InMemoryAgentRunStore()
    incoming = request()
    run_id = incoming.context.run_id
    await store.create(incoming)
    await store.mark_running(run_id)
    await store.record_usage(run_id, usage(run_id))
    await save_progress(store, run_id)
    original = await store.get(run_id)
    deadline = started_at(store, run_id) + timedelta(
        seconds=incoming.budget.max_duration_seconds + INTERRUPTED_RUN_GRACE_SECONDS,
    )

    live = await store.reconcile_stalled(run_id, deadline - timedelta(microseconds=1))
    assert live.status is AgentRunStatus.RUNNING
    failed = await store.reconcile_stalled(run_id, deadline)
    assert failed.status is AgentRunStatus.FAILED
    assert failed.error_code == INTERRUPTED_RUN_ERROR
    assert failed.result == original.result == saved_result()
    assert failed.usage == original.usage
    assert not failed.usage.execution_closed
    assert not failed.usage.provider_calls[0].usage_known
    assert failed.active_department is DepartmentName.REQUIREMENTS
    events = await store.list_events(run_id)
    assert await store.reconcile_stalled(run_id, deadline + timedelta(days=1)) == failed
    assert await store.list_events(run_id) == events
    with pytest.raises(AgentRunStateError):
        await store.mark_running(run_id)


@pytest.mark.parametrize("status", [AgentRunStatus.WAITING_FOR_USER, AgentRunStatus.COMPLETED,
                                    AgentRunStatus.PARTIAL, AgentRunStatus.FAILED, AgentRunStatus.CANCELLED])
async def test_waiting_or_terminal_work_never_expires_by_stalled_run_detection(status: AgentRunStatus) -> None:
    store = InMemoryAgentRunStore()
    incoming = request()
    run_id = incoming.context.run_id
    await store.create(incoming)
    await store.mark_running(run_id)
    await save_progress(store, run_id)
    if status is AgentRunStatus.WAITING_FOR_USER:
        await store.complete(run_id, ExecutionOutcome(interruption=AgentInterruption(
            interruption_id=uuid4(), kind=InterruptionKind.CLARIFICATION, questions=["보완 질문"],
        )))
    elif status in {AgentRunStatus.COMPLETED, AgentRunStatus.PARTIAL}:
        await store.complete(run_id, ExecutionOutcome(result=saved_result(),
            partial_error_code="MODEL_PROVIDER_FAILED" if status is AgentRunStatus.PARTIAL else None))
    elif status is AgentRunStatus.FAILED:
        await store.fail(run_id, "SPRING_TOOL_UNAUTHORIZED")
    else:
        await store.cancel(run_id)
    before = await store.get(run_id)
    assert before.result == saved_result()
    assert await store.reconcile_stalled(run_id, datetime.now(UTC) + timedelta(days=100)) == before


@pytest.mark.parametrize("status", [AgentRunStatus.FAILED, AgentRunStatus.CANCELLED])
async def test_terminal_attempt_fence_allows_known_late_settlement_without_new_provider_call(status) -> None:
    store = InMemoryAgentRunStore()
    incoming = request()
    run_id = incoming.context.run_id
    original_usage = usage(run_id)
    await store.create(incoming)
    await store.mark_running(run_id)
    await store.record_usage(run_id, original_usage)
    await save_progress(store, run_id)
    if status is AgentRunStatus.FAILED:
        await store.fail(run_id, INTERRUPTED_RUN_ERROR)
    else:
        await store.cancel(run_id)
    before = await store.get(run_id)
    with pytest.raises(AgentRunStateError):
        await store.record_usage(run_id, usage(run_id))
    assert await store.get(run_id) == before
    settled = original_usage.model_copy(update={
        "provider_calls": [original_usage.provider_calls[0].model_copy(update={
            "input_tokens": 10, "output_tokens": 5, "cost_usd": Decimal("0.005"), "usage_known": True,
        })], "execution_closed": True,
    })
    await store.record_usage(run_id, settled)
    after = await store.get(run_id)
    assert after.status is status and after.result == saved_result()
    assert after.usage.model_calls == 1
    assert after.usage.platform_cost_usd == Decimal("0.005")
    assert after.usage.execution_closed and after.usage.provider_calls[0].usage_known


async def test_completion_and_stalled_reconciliation_are_atomic() -> None:
    store = InMemoryAgentRunStore()
    incoming = request()
    run_id = incoming.context.run_id
    await store.create(incoming)
    await store.mark_running(run_id)
    await save_progress(store, run_id)
    deadline = started_at(store, run_id) + timedelta(seconds=60)
    outcomes = await asyncio.gather(
        store.complete(run_id, ExecutionOutcome(result=AgentRunResult(project_summary="Complete genuine output"))),
        store.reconcile_stalled(run_id, deadline), return_exceptions=True,
    )
    assert all(not isinstance(value, Exception) or isinstance(value, AgentRunStateError) for value in outcomes)
    final = await store.get(run_id)
    assert final.status in {AgentRunStatus.COMPLETED, AgentRunStatus.FAILED}
    events = await store.list_events(run_id)
    assert sum(event.type in {"run.completed", "run.failed"} for event in events) == 1


async def test_fresh_coordinator_closes_stalled_state_without_replaying_executor() -> None:
    store = InMemoryAgentRunStore()
    incoming = request()
    run_id = incoming.context.run_id
    await store.create(incoming)
    await store.mark_running(run_id)
    record = store._records[run_id]
    record.events[-1] = record.events[-1].model_copy(update={"occurred_at": datetime.now(UTC) - timedelta(minutes=2)})
    executor = AsyncMock()
    restarted = RunCoordinator(store, executor)
    accepted = await restarted.accept(incoming)
    assert accepted.status is AgentRunStatus.FAILED
    await restarted.execute(incoming)
    assert (await restarted.view(run_id)).error_code == INTERRUPTED_RUN_ERROR
    executor.execute.assert_not_awaited()


def expired_request(funding: str) -> AgentRunRequest:
    incoming = request()
    selected = ModelSelection(provider=Provider.OPENAI, model="gpt-6-luna",
                              credential_id=uuid4() if funding == "BYOK" else None)
    incoming = incoming.model_copy(update={"model_selection": selected})
    expired_at = datetime.now(UTC) - timedelta(seconds=1)
    if funding == "PLATFORM":
        return incoming.model_copy(update={"platform_budget": PlatformBudget(
            reservation_id=incoming.context.run_id, max_cost_usd=Decimal("1"),
            tariff_version="platform-ai-2026-10-05-v2", valid_until=expired_at,
        )})
    context = incoming.context
    return incoming.model_copy(update={"byok_budget": ByokBudget(
        scope_id=uuid4(), run_id=context.run_id, workspace_id=context.workspace_id,
        project_id=context.project_id, initiated_by=context.initiated_by,
        credential_id=selected.credential_id, provider=selected.provider, model=selected.model,
        reasoning_effort=selected.reasoning_effort, funding_source="BYOK", service_tier="default",
        valid_until=expired_at, max_model_calls=incoming.budget.max_model_calls,
        max_input_tokens=incoming.budget.max_input_tokens, max_output_tokens=incoming.budget.max_output_tokens,
        budget=incoming.budget,
    )})


@pytest.mark.parametrize("funding", ["PLATFORM", "BYOK"])
async def test_matching_terminal_retry_after_budget_expiry_acknowledges_without_renewal(funding: str) -> None:
    incoming = expired_request(funding)
    store = InMemoryAgentRunStore()
    run_id = incoming.context.run_id
    await store.create(incoming)
    await store.mark_running(run_id)
    await store.complete(run_id, ExecutionOutcome(result=saved_result()))
    before = await store.get(run_id)
    executor = AsyncMock()
    coordinator = RunCoordinator(store, executor, require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
    assert (await coordinator.accept(incoming)).status is AgentRunStatus.COMPLETED
    await coordinator.execute(incoming)
    assert await store.get_request(run_id) == incoming
    assert await store.get(run_id) == before
    executor.execute.assert_not_awaited()
    with pytest.raises(PlatformBudgetError, match=f"{funding}_BUDGET_EXPIRED"):
        await coordinator.accept(expired_request(funding))


async def test_live_sse_emits_reconciled_failure_before_terminal_close() -> None:
    from api.agent_runs.router import _event_stream

    store = InMemoryAgentRunStore()
    incoming = request()
    run_id = incoming.context.run_id
    await store.create(incoming)
    await store.mark_running(run_id)
    record = store._records[run_id]
    record.events[-1] = record.events[-1].model_copy(update={
        "occurred_at": datetime.now(UTC) - timedelta(minutes=2),
    })
    coordinator = RunCoordinator(store, AsyncMock())
    streamed = [event async for event in _event_stream(coordinator, run_id, 0)]
    assert len(streamed) == 3
    assert "event: run.failed" in streamed[-1]
    assert INTERRUPTED_RUN_ERROR in streamed[-1]


async def test_execution_deadline_stops_a_resumed_worker_without_a_fresh_duration() -> None:
    from runtime import ExecutionAuthorization

    incoming = request()
    store = InMemoryAgentRunStore()
    executor = AsyncMock()
    coordinator = RunCoordinator(store, executor)
    await coordinator.accept(incoming)
    expired = ExecutionAuthorization("synthetic", execution_deadline=datetime.now(UTC) - timedelta(seconds=1))
    await coordinator.execute(incoming, expired)
    view = await store.get(incoming.context.run_id)
    assert view.status is AgentRunStatus.FAILED
    assert view.error_code == "RUN_TIMEOUT"
    executor.execute.assert_not_awaited()
