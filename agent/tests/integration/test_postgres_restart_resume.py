from __future__ import annotations

import os
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
    ResumeAgentRunRequest,
    ResumeAnswer,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from infrastructure import PostgresCheckpointJournal
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from runtime import ExecutionAuthorization, ExecutionOutcome, PostgresAgentRunStore, RunCoordinator

DATABASE_URL = os.getenv("AGENT_INTEGRATION_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="AGENT_INTEGRATION_DATABASE_URL is not configured")


class InterruptThenCompleteExecutor:
    async def execute(self, request: AgentRunRequest, resume: ResumeAgentRunRequest | None = None, authorization: ExecutionAuthorization | None = None) -> ExecutionOutcome:  # noqa: E501
        del request
        assert authorization is not None
        if resume is None:
            return ExecutionOutcome(
                interruption=AgentInterruption(
                    interruption_id=uuid4(),
                    kind=InterruptionKind.CLARIFICATION,
                    questions=["납기일을 입력해 주세요."],
                )
            )
        return ExecutionOutcome(result=AgentRunResult(project_summary=resume.answers[0].answer))


async def test_hitl_resume_survives_fresh_database_and_checkpoint_instances() -> None:
    assert DATABASE_URL is not None
    request = agent_request()
    authorization = ExecutionAuthorization("ephemeral-token")
    first_database = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
    first_journal = PostgresCheckpointJournal(DATABASE_URL)

    await first_database.open()
    await first_database.create_runtime_tables()
    await first_journal.open()
    first_store = PostgresAgentRunStore(first_database)
    first_coordinator = RunCoordinator(first_store, InterruptThenCompleteExecutor(), first_journal)
    try:
        await first_coordinator.accept(request)
        await first_coordinator.execute(request, authorization)
        waiting = await first_coordinator.view(request.context.run_id)
        assert waiting.status is AgentRunStatus.WAITING_FOR_USER
        assert waiting.interruption is not None
        interruption_id = waiting.interruption.interruption_id
    finally:
        # 모든 runtime 객체를 닫아 실제 프로세스 종료와 같은 연결 단절을 만듭니다.
        await first_journal.close()
        await first_database.close()

    second_database = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
    second_journal = PostgresCheckpointJournal(DATABASE_URL)
    await second_database.open()
    await second_journal.open()
    second_store = PostgresAgentRunStore(second_database)
    second_coordinator = RunCoordinator(second_store, InterruptThenCompleteExecutor(), second_journal)
    command = ResumeAgentRunRequest(
        interruption_id=interruption_id,
        idempotency_key="restart-resume-1",
        answers=[ResumeAnswer(question_index=0, answer="2026-09-30")],
    )
    try:
        _, persisted_request = await second_coordinator.accept_resume(request.context.run_id, command)
        assert len(persisted_request.clarification_history) == 1
        assert persisted_request.clarification_history[0].answer == "2026-09-30"
        await second_coordinator.resume(persisted_request, command, authorization)
        completed = await second_coordinator.view(request.context.run_id)

        assert completed.status is AgentRunStatus.COMPLETED
        assert completed.result is not None
        assert completed.result.project_summary == "2026-09-30"
        assert completed.interruption is None
        events = await second_coordinator.events(request.context.run_id)
        assert [event.type for event in events][-3:] == [
            "clarification.responded",
            "run.started",
            "run.completed",
        ]
    finally:
        await second_journal.close()
        await second_database.close()


def agent_request() -> AgentRunRequest:
    return AgentRunRequest(
        context=TrustedRunContext(
            run_id=uuid4(),
            thread_id=uuid4(),
            trace_id="trace-postgres-restart",
            workspace_id=uuid4(),
            project_id=uuid4(),
            initiated_by=uuid4(),
            effective_permissions=["agent.run"],
        ),
        budget=RunBudget(
            max_duration_seconds=30,
            max_model_calls=2,
            max_tool_calls=1,
            max_input_tokens=1000,
            max_output_tokens=1000,
            max_departments=1,
            max_hierarchy_depth=1,
        ),
        model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
        safety_context=SafetyContextInput(),
        input=AgentInput(requirement_text="재시작 복구 테스트"),
    )
