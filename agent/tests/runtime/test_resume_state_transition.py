from uuid import uuid4

import pytest

from contracts import (
    AgentInput,
    AgentInterruption,
    AgentRunRequest,
    AgentRunStatus,
    InterruptionKind,
    ModelSelection,
    Provider,
    ResumeAgentRunRequest,
    ResumeAnswer,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from runtime import AgentRunStateError, ExecutionOutcome, InMemoryAgentRunStore


@pytest.mark.asyncio
async def test_resume_atomically_consumes_the_active_interruption() -> None:
    store = InMemoryAgentRunStore()
    run_id = uuid4()
    interruption_id = uuid4()
    request = _request(run_id)
    await store.create(request)
    await store.mark_running(run_id)
    await store.complete(
        run_id,
        ExecutionOutcome(
            interruption=AgentInterruption(
                interruption_id=interruption_id,
                kind=InterruptionKind.CLARIFICATION,
                questions=["예산을 알려주세요."],
            )
        ),
    )

    await store.prepare_resume(run_id, _resume(interruption_id, "resume-key-one"))

    queued = await store.get(run_id)
    assert queued.status is AgentRunStatus.QUEUED
    assert queued.interruption is None
    with pytest.raises(AgentRunStateError):
        await store.prepare_resume(run_id, _resume(interruption_id, "resume-key-two"))


@pytest.mark.asyncio
async def test_start_retry_with_the_same_run_and_payload_is_idempotent() -> None:
    store = InMemoryAgentRunStore()
    request = _request(uuid4())

    first = await store.create(request)
    retried = await store.create(request)

    assert retried.run_id == first.run_id
    assert retried.status is AgentRunStatus.QUEUED
    assert len(await store.list_events(first.run_id)) == 1


def _resume(interruption_id, key: str) -> ResumeAgentRunRequest:
    return ResumeAgentRunRequest(
        interruption_id=interruption_id,
        idempotency_key=key,
        answers=[ResumeAnswer(question_index=0, answer="500만원입니다.")],
    )


def _request(run_id) -> AgentRunRequest:
    return AgentRunRequest(
        context=TrustedRunContext(
            run_id=run_id,
            thread_id=uuid4(),
            trace_id="trace-resume-transition",
            workspace_id=uuid4(),
            project_id=uuid4(),
            initiated_by=uuid4(),
            effective_permissions=["agent.run", "agent.respond"],
        ),
        budget=RunBudget(
            max_duration_seconds=30,
            max_model_calls=1,
            max_tool_calls=1,
            max_input_tokens=1000,
            max_output_tokens=1000,
            max_departments=1,
            max_hierarchy_depth=1,
        ),
        model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
        safety_context=SafetyContextInput(),
        input=AgentInput(requirement_text="견적을 작성합니다."),
    )
