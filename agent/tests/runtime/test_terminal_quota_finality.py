"""Quota settlement must not depend on polling before/after a post-result journal failure."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from contracts import (
    AgentInput,
    AgentRunRequest,
    AgentRunResult,
    AgentRunStatus,
    ModelSelection,
    Provider,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from runtime import ExecutionOutcome, InMemoryAgentRunStore, PostgresAgentRunStore, RunCoordinator
from runtime.runs import NullCheckpointJournal


def request() -> AgentRunRequest:
    return AgentRunRequest(
        context=TrustedRunContext(
            run_id=uuid4(), thread_id=uuid4(), trace_id="terminal-quota-test", workspace_id=uuid4(),
            project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run"],
        ),
        budget=RunBudget(max_duration_seconds=30, max_model_calls=1, max_tool_calls=1, max_input_tokens=1000,
                         max_output_tokens=1000, max_departments=1, max_hierarchy_depth=1),
        model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
        safety_context=SafetyContextInput(), input=AgentInput(requirement_text="Synthetic quota finality test"),
    )


@pytest.mark.parametrize("partial", [False, True])
async def test_late_failure_cannot_change_a_consumed_result(partial: bool) -> None:
    store = InMemoryAgentRunStore()
    incoming = request()
    run_id = incoming.context.run_id
    await store.create(incoming)
    await store.mark_running(run_id)
    await store.complete(run_id, ExecutionOutcome(result=AgentRunResult(project_summary="delivered"),
                                                 partial_error_code="PARTIAL_OUTPUT" if partial else None))
    before = await store.get(run_id)
    events_before = await store.list_events(run_id)
    await store.fail(run_id, "LATE_JOURNAL_FAILURE")
    after = await store.get(run_id)
    assert after == before
    assert after.status is (AgentRunStatus.PARTIAL if partial else AgentRunStatus.COMPLETED)
    assert await store.list_events(run_id) == events_before


@pytest.mark.parametrize("status", [AgentRunStatus.COMPLETED, AgentRunStatus.PARTIAL,
                                    AgentRunStatus.FAILED, AgentRunStatus.CANCELLED])
async def test_postgres_terminal_fail_guard_does_not_mutate_or_emit_events(status: AgentRunStatus) -> None:
    database = MagicMock()
    database.session.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
    database.session.return_value.__aexit__ = AsyncMock(return_value=None)
    store = PostgresAgentRunStore(database)
    row = SimpleNamespace(status=status.value)
    store._locked = AsyncMock(return_value=row)
    store._append_event = AsyncMock()
    await store.fail(uuid4(), "LATE_FAILURE")
    assert row.status == status.value
    store._append_event.assert_not_awaited()


@pytest.mark.parametrize("partial", [False, True])
async def test_final_checkpoint_failure_preserves_result_and_no_failed_event(partial: bool) -> None:
    class FailingFinalJournal(NullCheckpointJournal):
        async def record(self, incoming, status, phase, **kwargs):
            if status in {AgentRunStatus.COMPLETED, AgentRunStatus.PARTIAL}:
                raise RuntimeError("Synthetic final checkpoint failure")

    executor = MagicMock()
    executor.execute = AsyncMock(return_value=ExecutionOutcome(
        result=AgentRunResult(project_summary="delivered"), partial_error_code="PARTIAL_OUTPUT" if partial else None,
    ))
    store = InMemoryAgentRunStore()
    coordinator = RunCoordinator(store, executor, FailingFinalJournal())
    incoming = request()
    await coordinator.accept(incoming)
    await coordinator.execute(incoming)
    view = await coordinator.view(incoming.context.run_id)
    assert view.status is (AgentRunStatus.PARTIAL if partial else AgentRunStatus.COMPLETED)
    assert view.result is not None and view.result.project_summary == "delivered"
    assert "run.failed" not in [event.type for event in await coordinator.events(incoming.context.run_id)]
