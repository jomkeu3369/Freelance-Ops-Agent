from __future__ import annotations

# ruff: noqa: E501, I001

import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from contracts import AgentInput, AgentRunRequest, DepartmentName, ModelSelection, Provider, RunBudget, SafetyContextInput, TrustedRunContext
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from runtime import AttemptStatus, DepartmentTask, ExecutionRoute, PostgresAgentRunStore, PostgresRuntimeEvaluationStore, PostgresTaskAttemptEventStore, PostgresTaskRegistry, TaskAttempt, TaskAttemptEventWrite, TaskExecutionSnapshot, TaskStatus

DATABASE_URL = os.getenv("AGENT_INTEGRATION_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="AGENT_INTEGRATION_DATABASE_URL is not configured")


async def test_terminal_observation_coverage_tracks_outbox_and_delivery_ack() -> None:
    assert DATABASE_URL is not None
    now = datetime.now(UTC)
    context = TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="terminal-observation", workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run", "project.read"])
    budget = RunBudget(max_duration_seconds=30, max_model_calls=2, max_tool_calls=2, max_input_tokens=1000, max_output_tokens=1000, max_departments=2, max_hierarchy_depth=1)
    request = AgentRunRequest(context=context, budget=budget, model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), safety_context=SafetyContextInput(), input=AgentInput(requirement_text="terminal observation integration"))
    snapshot = TaskExecutionSnapshot(route=ExecutionRoute.REACT_AGENT, permissions=context.effective_permissions, budget=budget, model_selection=request.model_selection, policy_version="task-guard-v1", prompt_version="research-v1", tool_schema_version="web-research-v1")
    task = DepartmentTask(task_id=uuid4(), run_id=context.run_id, workspace_id=context.workspace_id, project_id=context.project_id, department=DepartmentName.RESEARCH, revision=1, execution=snapshot, created_at=now)
    attempt = TaskAttempt(attempt_id=uuid4(), task_id=task.task_id, run_id=task.run_id, workspace_id=task.workspace_id, task_revision=1, attempt_number=1)
    database = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
    await database.open()
    registry = PostgresTaskRegistry(database)
    events = PostgresTaskAttemptEventStore(database)
    try:
        await PostgresAgentRunStore(database).initialize()
        await registry.initialize()
        await PostgresAgentRunStore(database).create(request)
        await registry.create_task(task)
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.ADMITTED)
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.QUEUED)
        await registry.create_attempt(attempt)
        await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.QUEUED, queued_at=now)
        started = TaskAttemptEventWrite(event_id=f"{attempt.attempt_id}:1:attempt.started", run_id=task.run_id, source="integration", source_event_id=f"{attempt.attempt_id}:1:attempt.started", task_id=task.task_id, task_revision=1, attempt_id=attempt.attempt_id, attempt_number=1, workspace_id=task.workspace_id, sequence=1, event_type="attempt.started", occurred_at=now)
        await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.RUNNING, started_at=now, event=started)
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.RUNNING)
        finished = now + timedelta(seconds=1)
        completed = TaskAttemptEventWrite(event_id=f"{attempt.attempt_id}:2:attempt.completed", run_id=task.run_id, source="integration", source_event_id=f"{attempt.attempt_id}:2:attempt.completed", task_id=task.task_id, task_revision=1, attempt_id=attempt.attempt_id, attempt_number=1, workspace_id=task.workspace_id, sequence=2, event_type="attempt.completed", occurred_at=finished)
        await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.COMPLETED, finished_at=finished, event=completed)
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.COMPLETED)
        evaluation = PostgresRuntimeEvaluationStore(database)
        coverage = await evaluation.terminal_observation_coverage(since=now - timedelta(seconds=1), until=finished + timedelta(seconds=1))
        assert (coverage.source_terminal_count, coverage.observed_terminal_count, coverage.delivered_terminal_count) == (1, 1, 0)
        claims = await events.claim_for_delivery()
        await events.acknowledge_delivery(claims)
        delivered = await evaluation.terminal_observation_coverage(since=now - timedelta(seconds=1), until=finished + timedelta(seconds=1))
        assert delivered.delivery_coverage == 1
    finally:
        await database.close()
