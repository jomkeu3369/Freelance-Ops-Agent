"""Real PostgreSQL recovery/race tests. Requires a migrated isolated integration database."""

# ruff: noqa: E501, I001

import asyncio
import os
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select, update, func

from contracts import AgentInput, AgentRunRequest, DepartmentName, ModelSelection, Provider, RunBudget, SafetyContextInput, TrustedRunContext
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from infrastructure.database.models import AgentSchedulerEntryModel, AgentTaskEventModel, AgentResearchBudgetModel
from runtime import PostgresAgentRunStore, PostgresTaskRegistry, PostgresShadowSchedulerStore, DepartmentTask, TaskExecutionSnapshot, ExecutionRoute, TaskAttempt, TaskStatus, AttemptStatus, SchedulerCandidate, SchedulerQueueKind, WorkerCapacitySnapshot
from runtime.research_budget import PostgresResearchBudgetLedger, ResearchBudgetConflict
from runtime.research_ownership import PostgresResearchOwnership
from runtime.research_worker import ResearchTaskWorker
from runtime.task_scheduler_store import SchedulerClaimConflictError

DATABASE_URL = os.getenv("AGENT_INTEGRATION_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="AGENT_INTEGRATION_DATABASE_URL is not configured")


@pytest.fixture
async def state():
    assert DATABASE_URL is not None
    database = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
    await database.open()
    now = datetime.now(UTC)
    context = TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="ownership-integration", workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run", "project.read"])
    request = AgentRunRequest(context=context, input=AgentInput(requirement_text="Check official policy"), budget=RunBudget(max_duration_seconds=60, max_model_calls=12, max_tool_calls=8, max_input_tokens=10000, max_output_tokens=4000, max_search_credits=2, max_departments=2, max_hierarchy_depth=1), model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), safety_context=SafetyContextInput())
    runs = PostgresAgentRunStore(database)
    registry = PostgresTaskRegistry(database)
    scheduler = PostgresShadowSchedulerStore(database)
    ledger = PostgresResearchBudgetLedger(database, [context.workspace_id])
    await runs.create(request)
    allocation = await ledger.reserve(request)
    assert allocation.shadow is not None
    execution = TaskExecutionSnapshot(route=ExecutionRoute.REACT_AGENT, permissions=context.effective_permissions, budget=allocation.shadow.budget, model_selection=request.model_selection, policy_version="task-guard-v1", prompt_version="research-v1", tool_schema_version="web-research-v1", specialist_profile="research-read-v1")
    task = DepartmentTask(task_id=uuid4(), run_id=context.run_id, workspace_id=context.workspace_id, project_id=context.project_id, department=DepartmentName.RESEARCH, revision=1, execution=execution, created_at=now)
    await registry.create_task(task)
    await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.ADMITTED)
    task = await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.QUEUED)
    attempt = TaskAttempt(attempt_id=uuid4(), task_id=task.task_id, task_revision=1, run_id=task.run_id, workspace_id=task.workspace_id, attempt_number=1, predicted_service_runtime_seconds=30, predictor_version="pilot-static-v1")
    await registry.create_attempt(attempt)
    attempt = await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.QUEUED, queued_at=now)
    pool = "test-ownership-" + str(uuid4())
    candidate = SchedulerCandidate(attempt.attempt_id, task.task_id, 1, task.workspace_id, pool, 3, 30, "pilot-static-v1", SchedulerQueueKind.READY, now, now)
    await scheduler.observe_queued(candidate, WorkerCapacitySnapshot(pool, 1, now))
    ownership = PostgresResearchOwnership(database)

    async def claim():
        result = await scheduler.claim_next(pool, "worker-a", datetime.now(UTC), workspace_ids=[task.workspace_id], attempt_ids=[attempt.attempt_id])
        assert result is not None
        await scheduler.acknowledge_dispatch(attempt.attempt_id, result.claim_id, result.claimed_by)
        return result

    async def expire():
        async with database.session() as session:
            await session.execute(update(AgentSchedulerEntryModel).where(AgentSchedulerEntryModel.attempt_id == attempt.attempt_id).values(lease_until=datetime.now(UTC) - timedelta(seconds=1)))

    def event(kind):
        return ResearchTaskWorker._event(task, attempt, 1, kind, datetime.now(UTC), phase="RESEARCH", milestone="integration test", data={"result": {"model_calls": 1, "tool_calls": 1, "input_tokens": 10, "output_tokens": 10, "search_credits": 1}} if kind == "attempt.completed" else {})

    try:
        yield SimpleNamespace(**locals())
    finally:
        await database.close()


async def test_ack_crash_requeues_and_old_worker_cannot_start(state):
    s = state
    old = await s.claim()
    await s.expire()
    restarted = PostgresResearchOwnership(s.database)
    assert await restarted.recover_expired(s.pool, [s.task.workspace_id]) == 1
    fresh = await s.claim()
    assert fresh.claim_id != old.claim_id
    with pytest.raises(SchedulerClaimConflictError):
        await restarted.begin(s.task, s.attempt, old, s.event("attempt.started"))
    await restarted.begin(s.task, s.attempt, fresh, s.event("attempt.started"))
    await restarted.finish(s.task, s.attempt, fresh, s.event("attempt.completed"))
    assert (await s.registry.get_attempt(s.attempt.attempt_id, s.task.workspace_id)).status is AttemptStatus.COMPLETED


async def test_worker_loss_is_terminal_and_late_result_cannot_overwrite(state):
    s = state
    claim = await s.claim()
    await s.ownership.begin(s.task, s.attempt, claim, s.event("attempt.started"))
    await s.expire()
    assert await s.ownership.recover_expired(s.pool, [s.task.workspace_id]) == 1
    with pytest.raises(SchedulerClaimConflictError):
        await s.ownership.finish(s.task, s.attempt, claim, s.event("attempt.completed"))
    assert await s.scheduler.claim_next(s.pool, "worker-b", datetime.now(UTC)) is None
    async with s.database.session() as session:
        events = list((await session.scalars(select(AgentTaskEventModel).where(AgentTaskEventModel.attempt_id == s.attempt.attempt_id).order_by(AgentTaskEventModel.sequence))).all())
        budget = await session.get(AgentResearchBudgetModel, s.task.run_id)
    assert [e.event_type for e in events] == ["attempt.started", "attempt.failed"]
    assert events[-1].data_json["failure_code"] == "WORKER_LOST"
    assert budget.shadow_status == "UNKNOWN"


async def test_two_connections_share_one_capacity_and_scope_filter(state):
    s = state
    second_attempt = s.attempt.model_copy(update={"attempt_id": uuid4(), "attempt_number": 2, "status": AttemptStatus.PREDICTED})
    await s.registry.create_attempt(second_attempt)
    second_attempt = await s.registry.transition_attempt(second_attempt.attempt_id, s.task.workspace_id, AttemptStatus.QUEUED, queued_at=s.now)
    second_candidate = SchedulerCandidate(second_attempt.attempt_id, s.task.task_id, 1, s.task.workspace_id, s.pool, 3, 30, "pilot-static-v1", SchedulerQueueKind.READY, s.now, s.now)
    await s.scheduler.observe_queued(second_candidate, WorkerCapacitySnapshot(s.pool, 1, s.now))
    assert await s.scheduler.claim_next(s.pool, "wrong-workspace", datetime.now(UTC), workspace_ids=[uuid4()]) is None
    assert await s.scheduler.claim_next(s.pool, "no-context", datetime.now(UTC), attempt_ids=[]) is None
    first, second = await asyncio.gather(s.scheduler.claim_next(s.pool, "a", datetime.now(UTC)), PostgresShadowSchedulerStore(s.database).claim_next(s.pool, "b", datetime.now(UTC)))
    assert sum(item is not None for item in (first, second)) == 1
    selected = first or second
    await s.scheduler.acknowledge_dispatch(selected.candidate.attempt_id, selected.claim_id, selected.claimed_by)
    assert await s.scheduler.claim_next(s.pool, "c", datetime.now(UTC)) is None
    with pytest.raises(SchedulerClaimConflictError, match="capacity"):
        await s.scheduler.claim_next(s.pool, "misconfigured", datetime.now(UTC), worker_count=2)


async def test_parent_budget_cannot_be_reserved_again_on_another_connection(state):
    s = state
    with pytest.raises(ResearchBudgetConflict):
        await PostgresResearchBudgetLedger(s.database, [s.task.workspace_id]).reserve(s.request)
    async with s.database.session() as session:
        assert await session.scalar(select(func.count()).select_from(AgentResearchBudgetModel).where(AgentResearchBudgetModel.run_id == s.task.run_id)) == 1
