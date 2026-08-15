from datetime import UTC, datetime
from uuid import UUID, uuid4

from contracts import (
    AgentInput,
    AgentRunRequest,
    AgentRunStatus,
    ModelSelection,
    Provider,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from infrastructure.database.models import AgentRunStateModel
from runtime import PostgresAgentRunStore


def test_view_limits_legacy_stored_interruption_questions() -> None:
    run_id = uuid4()
    request = _agent_request(run_id)
    questions = [f"질문 {index}" for index in range(1, 10)]
    model = AgentRunStateModel(
        run_id=run_id,
        request_json=request.model_dump(mode="json"),
        status=AgentRunStatus.WAITING_FOR_USER.value,
        active_department=None,
        interruption_json={
            "interruptionId": str(uuid4()),
            "kind": "CLARIFICATION",
            "questions": questions,
        },
        result_json=None,
        usage_json=None,
        error_code=None,
        idempotency_keys=[],
        updated_at=datetime.now(UTC)
    )

    view = PostgresAgentRunStore._view(model)

    assert view.interruption is not None
    assert view.interruption.questions == questions[:3]


def _agent_request(run_id: UUID) -> AgentRunRequest:
    return AgentRunRequest(
        context=TrustedRunContext(
            run_id=run_id,
            thread_id=uuid4(),
            trace_id="trace-legacy-interruption",
            workspace_id=uuid4(),
            project_id=uuid4(),
            initiated_by=uuid4(),
            effective_permissions=["agent.run"]
        ),
        budget=RunBudget(
            max_duration_seconds=30,
            max_model_calls=1,
            max_tool_calls=1,
            max_input_tokens=1000,
            max_output_tokens=1000,
            max_departments=1,
            max_hierarchy_depth=1
        ),
        model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"),
        safety_context=SafetyContextInput(),
        input=AgentInput(requirement_text="레거시 중단 기록을 조회합니다.")
    )
