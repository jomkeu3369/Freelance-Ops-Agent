# ruff: noqa: E501, I001

from __future__ import annotations

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import select

from contracts import AgentInput, AgentRunRequest, DepartmentName, ModelSelection, Provider, RunBudget, SafetyContextInput, TrustedRunContext
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from infrastructure.database.models import AgentRetryBucketModel
from runtime import AttemptStatus, DepartmentTask, ExecutionRoute, FailureSignals, PostgresAgentRunStore, PostgresTaskAttemptEventStore, PostgresTaskRegistry, PostgresTaskReliabilityStore, RetryDecision, TaskAttempt, TaskCheckpoint, TaskExecutionSnapshot, TaskStatus, issue_resume_token

DATABASE_URL = os.getenv("AGENT_INTEGRATION_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="AGENT_INTEGRATION_DATABASE_URL is not configured")


async def test_checkpoint_and_retry_decision_are_atomic_idempotent_and_secret_free() -> None:
    assert DATABASE_URL is not None
    budget = RunBudget(max_duration_seconds=60, max_model_calls=2, max_tool_calls=2, max_input_tokens=1000, max_output_tokens=1000, max_departments=1, max_hierarchy_depth=1, max_retries=2)
    context = TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="task-reliability-integration", workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run", "project.read"])
    request = AgentRunRequest(context=context, budget=budget, model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), safety_context=SafetyContextInput(), input=AgentInput(requirement_text="Task reliability integration"))
    snapshot = TaskExecutionSnapshot(route=ExecutionRoute.REACT_AGENT, permissions=context.effective_permissions, budget=budget, model_selection=request.model_selection, policy_version="task-guard-v1", prompt_version="research-v1", tool_schema_version="web-research-v1")
    task = DepartmentTask(task_id=uuid4(), run_id=context.run_id, workspace_id=context.workspace_id, project_id=context.project_id, department=DepartmentName.RESEARCH, revision=1, execution=snapshot, created_at=datetime.now(UTC))
    attempt = TaskAttempt(attempt_id=uuid4(), task_id=task.task_id, run_id=task.run_id, workspace_id=task.workspace_id, task_revision=1, attempt_number=1)
    database = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
    await database.open()
    run_store = PostgresAgentRunStore(database)
    registry = PostgresTaskRegistry(database)
    reliability = PostgresTaskReliabilityStore(database)
    await run_store.initialize()

    try:
        await run_store.create(request)
        await registry.create_task(task)
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.ADMITTED)
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.QUEUED)
        await registry.create_attempt(attempt)
        await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.QUEUED, queued_at=datetime.now(UTC))
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.RUNNING)
        await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.RUNNING, started_at=datetime.now(UTC))
        token, token_hash = issue_resume_token()
        checkpoint = TaskCheckpoint(checkpoint_id="checkpoint-1", artifact_reference="artifact://checkpoint-1", resume_token_hash=token_hash, completed_steps=["plan"], side_effect_idempotency_keys=["tool-read-1"], durable_progress_seconds=30, created_at=datetime.now(UTC))

        first = await reliability.checkpoint(attempt.attempt_id, task.workspace_id, checkpoint, source="integration-worker", source_event_id="checkpoint-1", sequence=1)
        repeated = await reliability.checkpoint(attempt.attempt_id, task.workspace_id, checkpoint, source="integration-worker", source_event_id="checkpoint-1", sequence=1)

        assert first == repeated
        assert token not in repr(first)
        assert token_hash not in repr(first)
        assert (await registry.get_task(task.task_id, 1, task.workspace_id)).status is TaskStatus.CHECKPOINTED
        restored = await registry.get_attempt(attempt.attempt_id, task.workspace_id)
        assert restored.checkpoint_id == "checkpoint-1"
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.RUNNING)
        await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.RUNNING)
        await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.FAILED, finished_at=datetime.now(UTC))

        decision = await reliability.decide_retry(attempt.attempt_id, task.workspace_id, FailureSignals(provider_error=True), max_attempts=3)
        repeated_decision = await reliability.decide_retry(attempt.attempt_id, task.workspace_id, FailureSignals(deterministic_error=True), max_attempts=3)

        assert decision == repeated_decision
        assert decision.decision is RetryDecision.ALLOW
        assert (await registry.get_task(task.task_id, 1, task.workspace_id)).status is TaskStatus.RETRY_WAIT
        events = await PostgresTaskAttemptEventStore(database).list_for_run(task.run_id)
        assert [event.event_type for event in events] == ["attempt.checkpointed", "attempt.retry_decided"]
        assert "resume_token" not in repr(events)
        async with database.session() as session:
            buckets = list((await session.scalars(select(AgentRetryBucketModel))).all())
        assert {bucket.bucket_key for bucket in buckets} == {"global", f"workspace:{task.workspace_id}"}
    finally:
        await database.close()
