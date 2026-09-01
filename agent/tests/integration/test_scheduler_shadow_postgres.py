# ruff: noqa: E501, I001

from __future__ import annotations

import os
import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from contracts import AgentInput, AgentRunRequest, DepartmentName, ModelSelection, Provider, RunBudget, SafetyContextInput, TrustedRunContext
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from runtime import AttemptStatus, DepartmentTask, ExecutionRoute, PostgresAgentRunStore, PostgresRuntimeEvaluationStore, PostgresRuntimeOperationalMetrics, PostgresShadowSchedulerStore, PostgresTaskRegistry, RuntimeEvaluationPolicy, RuntimeReleaseKind, RuntimeReleaseStatus, SchedulerCandidate, SchedulerEvaluationMetrics, SchedulerQueueKind, TaskAttempt, TaskExecutionSnapshot, TaskStatus, WorkerCapacitySnapshot, evaluate_runtime_release, runtime_dataset_fingerprint

DATABASE_URL = os.getenv("AGENT_INTEGRATION_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="AGENT_INTEGRATION_DATABASE_URL is not configured")


async def test_scheduler_preserves_fifo_claim_and_records_shadow_snapshot() -> None:
    assert DATABASE_URL is not None
    budget = RunBudget(max_duration_seconds=60, max_model_calls=2, max_tool_calls=2, max_input_tokens=1000, max_output_tokens=1000, max_departments=1, max_hierarchy_depth=1, max_retries=2)
    context = TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="scheduler-shadow-integration", workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run", "project.read"])
    request = AgentRunRequest(context=context, budget=budget, model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), safety_context=SafetyContextInput(), input=AgentInput(requirement_text="Scheduler shadow integration"))
    execution = TaskExecutionSnapshot(route=ExecutionRoute.REACT_AGENT, permissions=context.effective_permissions, budget=budget, model_selection=request.model_selection, policy_version="task-guard-v1", prompt_version="research-v1", tool_schema_version="web-research-v1")
    queued_at = datetime.now(UTC)
    task = DepartmentTask(task_id=uuid4(), run_id=context.run_id, workspace_id=context.workspace_id, project_id=context.project_id, department=DepartmentName.RESEARCH, revision=1, execution=execution, created_at=queued_at)
    attempt = TaskAttempt(attempt_id=uuid4(), task_id=task.task_id, run_id=task.run_id, workspace_id=task.workspace_id, task_revision=1, attempt_number=1, predicted_service_runtime_seconds=12, predictor_version="predictor-v1")
    candidate = SchedulerCandidate(attempt.attempt_id, task.task_id, 1, task.workspace_id, "default", task.priority, 12, "predictor-v1", SchedulerQueueKind.READY, queued_at, queued_at)
    capacity = WorkerCapacitySnapshot("default", 6, queued_at)
    database = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
    await database.open()
    run_store = PostgresAgentRunStore(database)
    registry = PostgresTaskRegistry(database)
    scheduler = PostgresShadowSchedulerStore(database)

    try:
        await run_store.create(request)
        await registry.create_task(task)
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.ADMITTED)
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.QUEUED)
        await registry.create_attempt(attempt)
        await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.QUEUED, queued_at=queued_at)
        await scheduler.record_capacity(uuid4(), capacity, source="integration-dispatcher")

        first = await scheduler.observe_queued(candidate, capacity)
        repeated = await scheduler.observe_queued(candidate, capacity)
        metrics = PostgresRuntimeOperationalMetrics(database)
        pending_snapshot = await metrics.snapshot("default", now=queued_at)
        concurrent_claims = await asyncio.gather(scheduler.claim_next("default", "worker-1", queued_at), scheduler.claim_next("default", "worker-2", queued_at))
        claims = [selected for selected in concurrent_claims if selected is not None]

        assert first == repeated
        assert first.shadow_admission.policy_version == "scheduler-shadow-v1"
        assert pending_snapshot.queue_depth == 1
        assert len(claims) == 1
        claim = claims[0]
        assert claim.candidate.attempt_id == attempt.attempt_id
        assert claim.rank.actual_rank == 1
        reclaimed = await scheduler.claim_next("default", "worker-3", claim.lease_until)
        assert reclaimed is not None
        assert reclaimed.claim_id != claim.claim_id
        await scheduler.acknowledge_dispatch(attempt.attempt_id, reclaimed.claim_id, "worker-3")
        assert await scheduler.claim_next("default", "worker-2", queued_at) is None
        dispatched_snapshot = await metrics.snapshot("default", now=claim.lease_until)
        assert dispatched_snapshot.queue_depth == 0
        assert dispatched_snapshot.expired_lease_count == 0
        started_at = queued_at + timedelta(seconds=1)
        finished_at = started_at + timedelta(seconds=12)
        await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.RUNNING, started_at=started_at)
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.RUNNING)
        await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.COMPLETED, finished_at=finished_at)
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.COMPLETED)
        evaluations = PostgresRuntimeEvaluationStore(database)
        batch = await evaluations.assemble(since=queued_at - timedelta(seconds=1), until=finished_at + timedelta(seconds=1), resource_pool="default")
        report = evaluate_runtime_release(batch.records, load_band_count=batch.load_band_count, source_terminal_count=batch.source_terminal_count, shadow_scheduler=SchedulerEvaluationMetrics(1, 1, 1, 1, 1), policy=RuntimeEvaluationPolicy(minimum_attempts=1, minimum_observation_days=0, minimum_load_bands=1, maximum_mae_seconds=1, maximum_p95_absolute_error_seconds=1, minimum_r2=-1))
        release_id = uuid4()
        fingerprint = runtime_dataset_fingerprint(batch.records)
        release = await evaluations.record_release(release_id, RuntimeReleaseKind.SCHEDULER_POLICY, "scheduler-shadow-v1", "default", "code://scheduler-shadow-v1", "a" * 64, fingerprint, report)
        repeated_release = await evaluations.record_release(release_id, RuntimeReleaseKind.SCHEDULER_POLICY, "scheduler-shadow-v1", "default", "code://scheduler-shadow-v1", "a" * 64, fingerprint, report)

        assert batch.source_terminal_count == 1
        assert batch.load_band_count == 1
        assert report.status is RuntimeReleaseStatus.SHADOW_ONLY
        assert release == repeated_release
    finally:
        await database.close()
