from __future__ import annotations

# ruff: noqa: E501, I001

import os
from datetime import UTC, datetime
from uuid import uuid4
from unittest.mock import Mock

import pytest

from contracts import AgentInput, AgentRunRequest, DepartmentName, DepartmentResult, ModelSelection, Provider, RunBudget, SafetyContextInput, SourceReference, TrustedRunContext
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from security import DelegationPrincipal, DelegationTokenVerifier
from runtime.research_budget import PostgresResearchBudgetLedger, split_research_budget
from runtime.research_ownership import PostgresResearchOwnership
from runtime import AttemptStatus, DepartmentTask, ExecutionRoute, InMemoryResearchDispatchContextBroker, PostgresAgentRunStore, PostgresResearchResultFence, PostgresShadowSchedulerStore, PostgresTaskRegistry, ResearchFifoDispatcherPilot, ResearchSpecialistResult, ResearchTaskWorker, ResearchWorkerDispatchSink, TaskAttempt, TaskExecutionSnapshot, TaskStatus

DATABASE_URL = os.getenv("AGENT_INTEGRATION_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="AGENT_INTEGRATION_DATABASE_URL is not configured")


class FixedResearchExecution:
    async def execute(self, task: DepartmentTask, *, objective: str, jurisdiction: str | None = None) -> ResearchSpecialistResult:
        del objective, jurisdiction
        source = SourceReference(title="Official policy", url="https://example.gov/policy", provider="DIRECT_HTTP", content_sha256="a" * 64, fetched_at=datetime.now(UTC), authority_level="OFFICIAL", jurisdiction="KR", excerpt="Official policy")
        result = DepartmentResult(department=DepartmentName.RESEARCH, status="COMPLETED", summary="Policy applies. [source:1]", sources=[source])
        return ResearchSpecialistResult(department_result=result, model_calls=1, tool_calls=1, input_tokens=10, output_tokens=10, citation_count=1, verification_status="PASSED", specialist_profile=task.execution.specialist_profile)


async def test_fifo_dispatcher_runs_fenced_research_worker_to_terminal_state() -> None:
    assert DATABASE_URL is not None
    now = datetime.now(UTC)
    budget = RunBudget(max_duration_seconds=60, max_model_calls=8, max_tool_calls=8, max_input_tokens=1000, max_output_tokens=1000, max_search_credits=2, max_departments=1, max_hierarchy_depth=1)
    context = TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="research-dispatch", workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run", "project.read"])
    request = AgentRunRequest(context=context, budget=budget, model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), safety_context=SafetyContextInput(), input=AgentInput(requirement_text="Check the official policy"))
    allocation = split_research_budget(request)
    assert allocation.shadow is not None
    execution = TaskExecutionSnapshot(route=ExecutionRoute.REACT_AGENT, permissions=context.effective_permissions, budget=allocation.shadow.budget, model_selection=request.model_selection, policy_version="task-guard-v1", prompt_version="research-v1", tool_schema_version="web-research-v1", specialist_profile="research-read-v1", authorization_revision=3, budget_revision=2)
    task = DepartmentTask(task_id=uuid4(), run_id=context.run_id, workspace_id=context.workspace_id, project_id=context.project_id, department=DepartmentName.RESEARCH, revision=1, execution=execution, created_at=now)
    attempt = TaskAttempt(attempt_id=uuid4(), task_id=task.task_id, run_id=task.run_id, workspace_id=task.workspace_id, task_revision=1, attempt_number=1, predicted_service_runtime_seconds=30, predictor_version="pilot-static-v1", queued_at=now)
    database = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
    await database.open()
    run_store = PostgresAgentRunStore(database)
    registry = PostgresTaskRegistry(database)
    scheduler = PostgresShadowSchedulerStore(database)
    verifier = Mock(spec=DelegationTokenVerifier)
    verifier.verify.return_value = DelegationPrincipal(str(context.initiated_by), "integration-test", context.run_id, context.workspace_id, context.project_id, context.initiated_by, frozenset(context.effective_permissions))
    broker = InMemoryResearchDispatchContextBroker(verifier)
    worker = ResearchTaskWorker(registry, FixedResearchExecution(), result_fence=PostgresResearchResultFence(registry), ownership=PostgresResearchOwnership(database))
    sink = ResearchWorkerDispatchSink(worker, broker)
    dispatcher = ResearchFifoDispatcherPilot(scheduler, sink, resource_pool="research-read-v1", claimed_by="dispatcher-integration")
    try:
        await run_store.create(request)
        await PostgresResearchBudgetLedger(database, [context.workspace_id]).reserve(request)
        await registry.create_task(task)
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.ADMITTED)
        task = await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.QUEUED)
        await registry.create_attempt(attempt)
        attempt = await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.QUEUED, queued_at=now)
        await broker.stage(request, task, attempt, "workload-token")
        await dispatcher.observe_queued(task, attempt, dispatcher.capacity(now))

        claim = await dispatcher.dispatch_once(now=now)
        await sink.wait()

        assert claim is not None
        assert (await registry.get_task(task.task_id, 1, task.workspace_id)).status is TaskStatus.COMPLETED
        assert (await registry.get_attempt(attempt.attempt_id, task.workspace_id)).status is AttemptStatus.COMPLETED
        assert await scheduler.claim_next("research-read-v1", "other-dispatcher", datetime.now(UTC)) is None
    finally:
        await database.close()
