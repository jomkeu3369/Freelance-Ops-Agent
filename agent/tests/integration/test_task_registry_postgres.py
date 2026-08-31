from __future__ import annotations

# ruff: noqa: E501, I001

import asyncio
import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from contracts import AgentInput, AgentRunRequest, DepartmentName, ModelSelection, Provider, RunBudget, SafetyContextInput, TrustedRunContext
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from runtime import AttemptAlreadyExistsError, AttemptStatus, DepartmentTask, ExecutionRoute, PostgresAgentRunStore, PostgresTaskRegistry, TaskAlreadyExistsError, TaskAttempt, TaskExecutionSnapshot, TaskRevisionConflictError, TaskScopeError, TaskStatus, TaskTransitionError

DATABASE_URL = os.getenv("AGENT_INTEGRATION_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="AGENT_INTEGRATION_DATABASE_URL is not configured")


def run_request() -> AgentRunRequest:
    return AgentRunRequest(context=TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="task-registry-integration", workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run", "project.read"]), budget=RunBudget(max_duration_seconds=120, max_model_calls=4, max_tool_calls=8, max_input_tokens=4000, max_output_tokens=2000, max_departments=2, max_hierarchy_depth=2), model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), safety_context=SafetyContextInput(), input=AgentInput(requirement_text="Task Registry 통합 테스트"))


def task_for(request: AgentRunRequest) -> DepartmentTask:
    snapshot = TaskExecutionSnapshot(route=ExecutionRoute.SUPERVISOR, permissions=request.context.effective_permissions, budget=request.budget, model_selection=request.model_selection, policy_version="routing-v1", prompt_version="research-v1", tool_schema_version="spring-tool-v1")
    return DepartmentTask(task_id=uuid4(), run_id=request.context.run_id, workspace_id=request.context.workspace_id, project_id=request.context.project_id, department=DepartmentName.RESEARCH, revision=1, execution=snapshot, created_at=datetime.now(UTC))


async def test_task_registry_persists_transitions_scope_and_attempts_across_connections() -> None:
    assert DATABASE_URL is not None
    request = run_request()
    database = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
    await database.open()
    run_store = PostgresAgentRunStore(database)
    registry = PostgresTaskRegistry(database)
    await run_store.initialize()
    await registry.initialize()
    await run_store.create(request)
    task = task_for(request)

    try:
        created = await registry.create_task(task)
        assert created == task
        assert await registry.create_task(task) == task
        with pytest.raises(TaskAlreadyExistsError):
            await registry.create_task(task.model_copy(update={"priority": 5}))
        admitted = await registry.transition_task(task.task_id, task.revision, task.workspace_id, TaskStatus.ADMITTED)
        assert admitted.status is TaskStatus.ADMITTED

        with pytest.raises(TaskScopeError):
            await registry.get_task(task.task_id, task.revision, uuid4())
        with pytest.raises(TaskRevisionConflictError):
            await registry.get_task(task.task_id, task.revision + 1, task.workspace_id)

        outcomes = await asyncio.gather(registry.transition_task(task.task_id, task.revision, task.workspace_id, TaskStatus.QUEUED), registry.transition_task(task.task_id, task.revision, task.workspace_id, TaskStatus.QUEUED), return_exceptions=True)
        assert sum(isinstance(value, DepartmentTask) for value in outcomes) == 1
        assert sum(isinstance(value, TaskTransitionError) for value in outcomes) == 1

        attempt = TaskAttempt(attempt_id=uuid4(), task_id=task.task_id, run_id=task.run_id, workspace_id=task.workspace_id, task_revision=task.revision, attempt_number=1, predicted_service_runtime_seconds=10.0, predictor_version="predictor-v1")
        await registry.create_attempt(attempt)
        assert await registry.create_attempt(attempt) == attempt
        with pytest.raises(AttemptAlreadyExistsError):
            await registry.create_attempt(attempt.model_copy(update={"attempt_id": uuid4()}))
        queued = await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.QUEUED, queued_at=datetime.now(UTC))
        assert queued.status is AttemptStatus.QUEUED

        revision_two = task.model_copy(update={"revision": 2, "status": TaskStatus.SUBMITTED})
        created_revision = await registry.create_next_revision(task.revision, revision_two)
        assert created_revision.revision == 2
        superseded = await registry.get_task(task.task_id, task.revision, task.workspace_id)
        assert superseded.status is TaskStatus.SUPERSEDED
    finally:
        await database.close()

    reopened_database = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
    await reopened_database.open()
    reopened_registry = PostgresTaskRegistry(reopened_database)
    try:
        restored = await reopened_registry.get_task(task.task_id, task.revision, task.workspace_id)
        assert restored.status is TaskStatus.SUPERSEDED
        current = await reopened_registry.get_task(task.task_id, 2, task.workspace_id)
        assert current.status is TaskStatus.SUBMITTED
        restored_attempt = await reopened_registry.get_attempt(attempt.attempt_id, task.workspace_id)
        assert restored_attempt.status is AttemptStatus.QUEUED
    finally:
        await reopened_database.close()
