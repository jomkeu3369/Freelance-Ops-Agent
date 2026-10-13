"""Real PostgreSQL continuity fences; no provider or credential network I/O."""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy import select

from contracts import (
    AgentInput,
    AgentRunRequest,
    AgentRunResult,
    AgentRunStatus,
    AgentRunUsage,
    DepartmentName,
    DepartmentResult,
    ModelSelection,
    Provider,
    ProviderCallUsage,
    RequestTier,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from infrastructure.database.models import AgentRunEventModel
from runtime import AgentRunStateError, ExecutionEvent, ExecutionOutcome, PostgresAgentRunStore, RunCoordinator
from runtime.continuity import INTERRUPTED_RUN_ERROR

DATABASE_URL = os.getenv("AGENT_INTEGRATION_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="AGENT_INTEGRATION_DATABASE_URL is not configured")


def request() -> AgentRunRequest:
    return AgentRunRequest(
        context=TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="continuity-postgres-test",
            workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run"]),
        budget=RunBudget(max_duration_seconds=30, max_model_calls=4, max_tool_calls=2, max_input_tokens=1000,
            max_output_tokens=1000, max_departments=4, max_hierarchy_depth=2),
        model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
        safety_context=SafetyContextInput(), input=AgentInput(requirement_text="Synthetic continuity test"),
    )


def saved_result() -> AgentRunResult:
    return AgentRunResult(project_summary="Validated requirements", department_results=[
        DepartmentResult(department=DepartmentName.REQUIREMENTS, status="COMPLETED", summary="Genuine first stage"),
    ])


def usage(run_id) -> AgentRunUsage:
    call = ProviderCallUsage(call_id=uuid4(), provider=Provider.OPENAI, model="gpt-test", operation="continuity-test",
        input_tokens=50, output_tokens=20, cost_usd=Decimal("0.02"), reserved_cost_usd=Decimal("0.02"),
        usage_known=False)
    return AgentRunUsage(request_tier=RequestTier.SINGLE_AGENT, model_calls=1, tool_calls=0, input_tokens=50,
        output_tokens=20, duration_ms=10, provider_calls=[call], platform_cost_usd=call.cost_usd,
        platform_reservation_id=run_id, tariff_version="test-tariff")


async def open_database() -> PgVectorConnectionManager:
    assert DATABASE_URL is not None
    database = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
    await database.open()
    await database.verify_runtime_tables()
    return database


async def test_restart_detects_stalled_run_preserves_work_and_never_replays_provider() -> None:
    incoming = request()
    run_id = incoming.context.run_id
    first = await open_database()
    try:
        store = PostgresAgentRunStore(first)
        await store.create(incoming)
        await store.mark_running(run_id)
        original_usage = usage(run_id)
        await store.record_usage(run_id, original_usage)
        await store.append_progress(run_id, ExecutionEvent("department.saved", {"savedDepartments": 1},
            partial_result=saved_result()))
        async with first.session() as session:
            started = await session.scalar(select(AgentRunEventModel).where(
                AgentRunEventModel.run_id == run_id, AgentRunEventModel.type == "run.started",
            ))
            assert started is not None
            started.occurred_at = datetime.now(UTC) - timedelta(minutes=2)
    finally:
        await first.close()

    second = await open_database()
    try:
        store = PostgresAgentRunStore(second)
        executor = AsyncMock()
        coordinator = RunCoordinator(store, executor)
        view = await coordinator.view(run_id)
        assert view.status is AgentRunStatus.FAILED and view.error_code == INTERRUPTED_RUN_ERROR
        assert view.result == saved_result() and view.usage == original_usage
        assert not view.usage.execution_closed and not view.usage.provider_calls[0].usage_known
        assert (await coordinator.accept(incoming)).status is AgentRunStatus.FAILED
        await coordinator.execute(incoming)
        executor.execute.assert_not_awaited()
        assert sum(event.type == "run.failed" for event in await store.list_events(run_id)) == 1
        with pytest.raises(AgentRunStateError):
            await store.record_usage(run_id, usage(run_id))
        settled = original_usage.model_copy(update={
            "provider_calls": [original_usage.provider_calls[0].model_copy(update={"usage_known": True})],
            "execution_closed": True,
        })
        await store.record_usage(run_id, settled)
        final = await store.get(run_id)
        assert final.status is AgentRunStatus.FAILED and final.result == saved_result()
        assert final.usage.execution_closed and final.usage.provider_calls[0].usage_known
    finally:
        await second.close()


async def test_concurrent_completion_or_reconciliation_has_one_terminal_winner() -> None:
    database = await open_database()
    try:
        store = PostgresAgentRunStore(database)
        incoming = request()
        run_id = incoming.context.run_id
        await store.create(incoming)
        running = await store.mark_running(run_id)
        outcomes = await asyncio.gather(
            store.complete(run_id, ExecutionOutcome(result=AgentRunResult(project_summary="Genuine completed work"))),
            store.reconcile_stalled(run_id, running.updated_at + timedelta(minutes=2)),
            return_exceptions=True,
        )
        assert all(not isinstance(value, Exception) or isinstance(value, AgentRunStateError) for value in outcomes)
        final = await store.get(run_id)
        assert final.status in {AgentRunStatus.FAILED, AgentRunStatus.COMPLETED}
        events = await store.list_events(run_id)
        assert sum(event.type in {"run.failed", "run.completed"} for event in events) == 1
    finally:
        await database.close()


async def test_live_execution_within_original_limit_is_not_reconciled_as_failed() -> None:
    database = await open_database()
    try:
        store = PostgresAgentRunStore(database)
        incoming = request()
        run_id = incoming.context.run_id
        await store.create(incoming)
        running = await store.mark_running(run_id)
        live = await store.reconcile_stalled(run_id, running.updated_at + timedelta(seconds=29))
        assert live.status is AgentRunStatus.RUNNING
        await store.cancel(run_id)
    finally:
        await database.close()
