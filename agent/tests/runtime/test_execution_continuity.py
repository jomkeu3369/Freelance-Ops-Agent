"""Honest retries and durable interrupted-run evidence without paid replay."""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from contracts import (
    AgentInput,
    AgentInterruption,
    AgentRunRequest,
    AgentRunResult,
    AgentRunStatus,
    InterruptionKind,
    ModelSelection,
    Provider,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from runtime import ExecutionOutcome, InMemoryAgentRunStore, RunCoordinator
from runtime.runs import NullCheckpointJournal


def request() -> AgentRunRequest:
    return AgentRunRequest(
        context=TrustedRunContext(
            run_id=uuid4(), thread_id=uuid4(), trace_id="execution-continuity-test",
            workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(),
            effective_permissions=["agent.run", "agent.respond"],
        ),
        budget=RunBudget(max_duration_seconds=30, max_model_calls=4, max_tool_calls=2,
                         max_input_tokens=1000, max_output_tokens=1000,
                         max_departments=4, max_hierarchy_depth=2),
        model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
        safety_context=SafetyContextInput(), input=AgentInput(requirement_text="Synthetic continuity test"),
    )


@pytest.mark.parametrize("status", [
    AgentRunStatus.RUNNING, AgentRunStatus.WAITING_FOR_USER, AgentRunStatus.COMPLETED,
    AgentRunStatus.PARTIAL, AgentRunStatus.FAILED, AgentRunStatus.CANCELLED,
])
async def test_start_retry_acknowledges_real_state_without_rewriting_checkpoint(status: AgentRunStatus) -> None:
    store = InMemoryAgentRunStore()
    incoming = request()
    run_id = incoming.context.run_id
    await store.create(incoming)
    await store.mark_running(run_id)
    if status is AgentRunStatus.WAITING_FOR_USER:
        await store.complete(run_id, ExecutionOutcome(interruption=AgentInterruption(
            interruption_id=uuid4(), kind=InterruptionKind.CLARIFICATION, questions=["확인 질문"],
        )))
    elif status in {AgentRunStatus.COMPLETED, AgentRunStatus.PARTIAL}:
        await store.complete(run_id, ExecutionOutcome(
            result=AgentRunResult(project_summary="Genuine output"),
            partial_error_code="MODEL_PROVIDER_FAILED" if status is AgentRunStatus.PARTIAL else None,
        ))
    elif status is AgentRunStatus.FAILED:
        await store.fail(run_id, "MODEL_PROVIDER_FAILED")
    elif status is AgentRunStatus.CANCELLED:
        await store.cancel(run_id)
    before = await store.get(run_id)
    events_before = await store.list_events(run_id)
    journal = NullCheckpointJournal()
    journal.record = AsyncMock()  # type: ignore[method-assign]
    executor = AsyncMock()
    coordinator = RunCoordinator(store, executor, journal)

    accepted = await coordinator.accept(incoming)
    await coordinator.execute(incoming)

    assert accepted.status is status
    assert await store.get(run_id) == before
    assert await store.list_events(run_id) == events_before
    journal.record.assert_not_awaited()
    executor.execute.assert_not_awaited()
