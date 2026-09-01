# ruff: noqa: E501, I001

from __future__ import annotations

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from contracts import AgentInput, AgentRunRequest, DepartmentName, ModelSelection, Provider, RunBudget, SafetyContextInput, SourceReference, TrustedRunContext
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from providers import ModelGeneration
from routing import ExecutionRisk, ToolProfile
from runtime import AttemptStatus, DepartmentTask, ExecutionRoute, PostgresAgentRunStore, PostgresTaskAttemptEventStore, PostgresTaskRegistry, ReadOnlyResearchSpecialist, ResearchTaskWorker, TaskAttempt, TaskExecutionSnapshot, TaskStatus
from web_research import ResearchCollection

DATABASE_URL = os.getenv("AGENT_INTEGRATION_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="AGENT_INTEGRATION_DATABASE_URL is not configured")


class IntegrationProvider:
    def __init__(self) -> None:
        self._calls = 0

    async def generate_react_step(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:
        del selection, prompt, max_output_tokens, max_attempts
        self._calls += 1
        if self._calls == 1:
            return ModelGeneration(payload={"action": "TOOL", "tool_name": "web_research", "arguments": {"query": "official policy"}, "summary": None, "open_questions": [], "quotation_drafts": []}, input_tokens=10, output_tokens=5)
        return ModelGeneration(payload={"action": "FINAL", "tool_name": None, "arguments": {}, "summary": "Verified policy. [source:1]", "open_questions": [], "quotation_drafts": []}, input_tokens=12, output_tokens=8)


class IntegrationResearchTool:
    async def collect(self, query: str, jurisdiction: str | None, max_search_credits: int, max_tool_calls: int) -> ResearchCollection:
        del query, jurisdiction
        assert max_search_credits >= 1 and max_tool_calls >= 2
        source = SourceReference(title="Official policy", url="https://example.gov/policy", provider="DIRECT_HTTP", content_sha256="b" * 64, fetched_at=datetime.now(UTC), authority_level="OFFICIAL", jurisdiction="KR", excerpt="Official policy evidence.")
        return ResearchCollection(sources=[source], search_credits=1, tool_calls=2, fetched_pages=1)


async def test_research_worker_persists_verified_result_and_outbox_events() -> None:
    assert DATABASE_URL is not None
    run_budget = RunBudget(max_duration_seconds=60, max_model_calls=3, max_tool_calls=4, max_input_tokens=1000, max_output_tokens=1000, max_departments=1, max_hierarchy_depth=1, max_search_credits=1, max_retries=1)
    context = TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="research-specialist-integration", workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run", "project.read"])
    request = AgentRunRequest(context=context, budget=run_budget, model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), safety_context=SafetyContextInput(), input=AgentInput(requirement_text="Research specialist 통합 테스트"))
    snapshot = TaskExecutionSnapshot(route=ExecutionRoute.REACT_AGENT, permissions=context.effective_permissions, budget=run_budget, model_selection=request.model_selection, policy_version="task-guard-v1", prompt_version="research-v1", tool_schema_version="web-research-v1", risk_level=ExecutionRisk.MEDIUM, tool_profile=ToolProfile.READ_ONLY, model_profile="react-read-v1", specialist_profile="research-read-v1", authorization_revision=3, budget_revision=2)
    task = DepartmentTask(task_id=uuid4(), run_id=context.run_id, workspace_id=context.workspace_id, project_id=context.project_id, department=DepartmentName.RESEARCH, revision=1, execution=snapshot, created_at=datetime.now(UTC))
    attempt = TaskAttempt(attempt_id=uuid4(), task_id=task.task_id, run_id=task.run_id, workspace_id=task.workspace_id, task_revision=task.revision, attempt_number=1)
    database = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
    await database.open()
    run_store = PostgresAgentRunStore(database)
    registry = PostgresTaskRegistry(database)
    await run_store.initialize()
    await registry.initialize()

    try:
        await run_store.create(request)
        await registry.create_task(task)
        await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.ADMITTED)
        queued_task = await registry.transition_task(task.task_id, 1, task.workspace_id, TaskStatus.QUEUED)
        await registry.create_attempt(attempt)
        queued_attempt = await registry.transition_attempt(attempt.attempt_id, task.workspace_id, AttemptStatus.QUEUED, queued_at=datetime.now(UTC))
        worker = ResearchTaskWorker(registry, ReadOnlyResearchSpecialist(IntegrationProvider(), IntegrationResearchTool()))
        result = await worker.run(queued_task, queued_attempt, objective="Check the official policy", jurisdiction="KR", current_permissions=context.effective_permissions, current_authorization_revision=3, current_budget_revision=2, parent_budget=run_budget)

        assert result.verification_status == "PASSED"
        assert (await registry.get_task(task.task_id, 1, task.workspace_id)).status is TaskStatus.COMPLETED
        assert (await registry.get_attempt(attempt.attempt_id, task.workspace_id)).status is AttemptStatus.COMPLETED
        events = await PostgresTaskAttemptEventStore(database).list_for_run(task.run_id)
        assert [event.event_type for event in events] == ["attempt.started", "attempt.completed"]
        assert events[-1].data["result"]["verification_status"] == "PASSED"
    finally:
        await database.close()
