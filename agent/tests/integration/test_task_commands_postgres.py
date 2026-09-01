# ruff: noqa: E501, I001

from __future__ import annotations

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from contracts import AgentInput, AgentRunRequest, DepartmentName, ModelSelection, Provider, RunBudget, SafetyContextInput, TrustedRunContext
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from routing import ExecutionRisk, ToolProfile
from runtime import AttemptStatus, DepartmentTask, ExecutionRoute, PostgresAgentRunStore, PostgresTaskAttemptEventStore, PostgresTaskCommandInbox, PostgresTaskRegistry, TaskAttempt, TaskCommand, TaskCommandStatus, TaskCommandType, TaskExecutionSnapshot, TaskStatus

DATABASE_URL = os.getenv("AGENT_INTEGRATION_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="AGENT_INTEGRATION_DATABASE_URL is not configured")


async def test_hard_redirect_and_cancel_are_idempotent_and_fence_late_attempts() -> None:
    assert DATABASE_URL is not None
    budget = RunBudget(max_duration_seconds=60, max_model_calls=2, max_tool_calls=2, max_input_tokens=1000, max_output_tokens=1000, max_departments=1, max_hierarchy_depth=1)
    context = TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="task-command-integration", workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run", "agent.respond", "agent.cancel", "project.read"])
    request = AgentRunRequest(context=context, budget=budget, model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), safety_context=SafetyContextInput(), input=AgentInput(requirement_text="Task command integration"))
    snapshot = TaskExecutionSnapshot(route=ExecutionRoute.REACT_AGENT, permissions=context.effective_permissions, budget=budget, model_selection=request.model_selection, policy_version="task-guard-v1", prompt_version="research-v1", tool_schema_version="web-research-v1", risk_level=ExecutionRisk.MEDIUM, tool_profile=ToolProfile.READ_ONLY, specialist_profile="research-read-v1", authorization_revision=3, budget_revision=2)
    task = DepartmentTask(task_id=uuid4(), run_id=context.run_id, workspace_id=context.workspace_id, project_id=context.project_id, department=DepartmentName.RESEARCH, revision=1, execution=snapshot, created_at=datetime.now(UTC))
    attempt = TaskAttempt(attempt_id=uuid4(), task_id=task.task_id, run_id=task.run_id, workspace_id=task.workspace_id, task_revision=1, attempt_number=1)
    database = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
    await database.open()
    run_store = PostgresAgentRunStore(database)
    registry = PostgresTaskRegistry(database)
    inbox = PostgresTaskCommandInbox(database)
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
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.CHECKPOINTED)
        await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.CHECKPOINTED)
        soft_update = TaskCommand(command_id=uuid4(), task_id=task.task_id, run_id=task.run_id, workspace_id=task.workspace_id, attempt_id=attempt.attempt_id, expected_revision=1, type=TaskCommandType.SOFT_UPDATE, idempotency_key="update-1", requested_by=context.initiated_by, requested_at=datetime.now(UTC), payload={"instruction": "공식 출처를 하나 더 확인해 주세요"}, authorization_revision=3, budget_revision=2)

        pending = await inbox.accept(soft_update)
        instruction = await inbox.apply_soft_update_at_checkpoint(soft_update.command_id, attempt.attempt_id, task.workspace_id)

        assert pending.status is TaskCommandStatus.PENDING
        assert instruction == soft_update.payload
        assert (await registry.get_task(task.task_id, 1, task.workspace_id)).status is TaskStatus.RUNNING
        assert (await registry.get_attempt(attempt.attempt_id, task.workspace_id)).status is AttemptStatus.RUNNING
        events = await PostgresTaskAttemptEventStore(database).list_for_run(task.run_id)
        assert events[-1].event_type == "attempt.update_applied"
        assert events[-1].data == {"command_id": str(soft_update.command_id)}
        redirect = TaskCommand(command_id=uuid4(), task_id=task.task_id, run_id=task.run_id, workspace_id=task.workspace_id, expected_revision=1, type=TaskCommandType.HARD_REDIRECT, idempotency_key="redirect-1", requested_by=context.initiated_by, requested_at=datetime.now(UTC), payload={"objective_reference": "objective:2"}, authorization_revision=3, budget_revision=2)

        first = await inbox.accept(redirect)
        repeated = await inbox.accept(redirect)

        assert first == repeated
        assert first.status is TaskCommandStatus.APPLIED
        assert first.target_revision == 2
        assert (await registry.get_task(task.task_id, 1, task.workspace_id)).status is TaskStatus.SUPERSEDED
        assert (await registry.get_task(task.task_id, 2, task.workspace_id)).status is TaskStatus.SUBMITTED
        assert (await registry.get_attempt(attempt.attempt_id, task.workspace_id)).status is AttemptStatus.SUPERSEDED

        cancel = TaskCommand(command_id=uuid4(), task_id=task.task_id, run_id=task.run_id, workspace_id=task.workspace_id, expected_revision=2, type=TaskCommandType.CANCEL, idempotency_key="cancel-2", requested_by=context.initiated_by, requested_at=datetime.now(UTC), authorization_revision=3, budget_revision=2)
        cancelled = await inbox.accept(cancel)

        assert cancelled.status is TaskCommandStatus.APPLIED
        assert (await registry.get_task(task.task_id, 2, task.workspace_id)).status is TaskStatus.CANCELLED
    finally:
        await database.close()
