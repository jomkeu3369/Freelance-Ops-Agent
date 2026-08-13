from uuid import UUID, uuid4

import pytest

from contracts import (
    AgentInput,
    AgentRunRequest,
    AgentRunStatus,
    DirectToolOperation,
    ModelSelection,
    ProjectContext,
    Provider,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from providers import ModelGeneration
from routing import FinalRouteDecision, RouteDecisionSource, RouteLabel
from runtime import (
    AgentExecutionError,
    ExecutionAuthorization,
    InMemoryAgentRunStore,
    OperationalAgentExecutor,
    RunCoordinator,
)


class FixedGateway:
    def __init__(self, route: RouteLabel) -> None:
        self.selected_route = route

    async def route(self, text: str, safety_context: object = None) -> FinalRouteDecision:
        del text, safety_context
        return FinalRouteDecision(
            route=self.selected_route,
            source=RouteDecisionSource.LLM_EVALUATOR,
            local_decision=None,
        )


class FixedProvider:
    def __init__(self, *, questions: list[str] | None = None, tokens: int = 10, model_calls: int = 1) -> None:
        self.questions = questions or []
        self.tokens = tokens
        self.model_calls = model_calls
        self.calls = 0

    async def generate_structured(
        self,
        selection: ModelSelection,
        prompt: str,
        *,
        max_output_tokens: int,
        max_attempts: int | None = None,
    ) -> ModelGeneration:
        del selection, prompt, max_output_tokens, max_attempts
        self.calls += 1
        return ModelGeneration(
            payload={"summary": "work product", "open_questions": self.questions},
            input_tokens=self.tokens,
            output_tokens=self.tokens,
            model_calls=self.model_calls,
        )


class FixedProjectContextTool:
    def __init__(self, request: AgentRunRequest) -> None:
        self._request = request
        self.token: str | None = None

    async def get_project_context(
        self,
        delegation_token: str,
        *,
        run_id: UUID,
        project_id: UUID,
        max_attempts: int | None = None,
        traceparent: str | None = None,
    ) -> ProjectContext:
        del run_id, project_id, max_attempts, traceparent
        self.token = delegation_token
        return ProjectContext(
            project_id=self._request.context.project_id,
            workspace_id=self._request.context.workspace_id,
            title="테스트 프로젝트",
            requirement_text="검증된 프로젝트 요구사항",
            currency="KRW",
        )


def _request(
    *,
    model_calls: int = 5,
    tool_calls: int = 0,
    input_tokens: int = 100,
    output_tokens: int = 100,
) -> AgentRunRequest:
    return AgentRunRequest(
        context=TrustedRunContext(
            run_id=uuid4(),
            thread_id=uuid4(),
            trace_id="trace-runtime",
            workspace_id=uuid4(),
            project_id=uuid4(),
            initiated_by=uuid4(),
            effective_permissions=["agent.run", "project.read"],
        ),
        budget=RunBudget(
            max_duration_seconds=30,
            max_model_calls=model_calls,
            max_tool_calls=tool_calls,
            max_input_tokens=input_tokens,
            max_output_tokens=output_tokens,
            max_departments=4,
            max_hierarchy_depth=1,
        ),
        model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-5.4-mini"),
        safety_context=SafetyContextInput(),
        input=AgentInput(requirement_text="프로젝트 요구사항을 분석해 주세요."),
    )


async def test_supervisor_executes_bounded_departments() -> None:
    request = _request(tool_calls=1)
    request.budget.max_hierarchy_depth = 2
    provider = FixedProvider()
    tool = FixedProjectContextTool(request)
    executor = OperationalAgentExecutor(FixedGateway(RouteLabel.SUPERVISOR), provider, tool)

    outcome = await executor.execute(
        request,
        authorization=ExecutionAuthorization("delegation-token"),
    )

    assert outcome.result is not None
    assert len(outcome.result.department_results) == 4
    assert provider.calls == 4
    assert tool.token == "delegation-token"


async def test_required_question_creates_clarification_interruption() -> None:
    executor = OperationalAgentExecutor(
        FixedGateway(RouteLabel.SIMPLE_LLM),
        FixedProvider(questions=["예산 상한은 얼마인가요?"]),
    )

    outcome = await executor.execute(_request())

    assert outcome.interruption is not None
    assert outcome.interruption.kind.value == "CLARIFICATION"


async def test_direct_tool_route_skips_department_model_generation() -> None:
    request = _request(model_calls=1, tool_calls=1)
    request.input.direct_tool_operation = DirectToolOperation.GET_PROJECT_CONTEXT
    provider = FixedProvider()
    tool = FixedProjectContextTool(request)
    executor = OperationalAgentExecutor(FixedGateway(RouteLabel.DIRECT_TOOL), provider, tool)

    outcome = await executor.execute(request, authorization=ExecutionAuthorization("delegation-token"))

    assert outcome.result is not None
    assert outcome.active_department is not None
    assert provider.calls == 0
    assert "테스트 프로젝트" in outcome.result.project_summary


async def test_model_call_budget_fails_before_department_call() -> None:
    provider = FixedProvider()
    executor = OperationalAgentExecutor(FixedGateway(RouteLabel.SUPERVISOR), provider)
    request = _request(model_calls=2)
    request.budget.max_hierarchy_depth = 2

    with pytest.raises(AgentExecutionError, match="MODEL_CALL_BUDGET_EXCEEDED"):
        await executor.execute(request)

    assert provider.calls == 0


async def test_supervisor_respects_hierarchy_depth_budget() -> None:
    executor = OperationalAgentExecutor(FixedGateway(RouteLabel.SUPERVISOR), FixedProvider())

    with pytest.raises(AgentExecutionError, match="HIERARCHY_DEPTH_EXCEEDED"):
        await executor.execute(_request(tool_calls=1))


async def test_supervisor_respects_handoff_budget() -> None:
    request = _request(tool_calls=1)
    request.budget.max_hierarchy_depth = 2
    request.budget.max_handoffs = 0
    executor = OperationalAgentExecutor(FixedGateway(RouteLabel.SUPERVISOR), FixedProvider())

    with pytest.raises(AgentExecutionError, match="HANDOFF_BUDGET_EXCEEDED"):
        await executor.execute(request)


async def test_provider_retry_calls_are_charged_to_run_budget() -> None:
    executor = OperationalAgentExecutor(
        FixedGateway(RouteLabel.SIMPLE_LLM),
        FixedProvider(model_calls=2),
    )

    with pytest.raises(AgentExecutionError, match="MODEL_CALL_BUDGET_EXCEEDED"):
        await executor.execute(_request(model_calls=2))


async def test_tool_route_fails_before_call_without_delegated_project_permission() -> None:
    request = _request(model_calls=1, tool_calls=1)
    request.input.direct_tool_operation = DirectToolOperation.GET_PROJECT_CONTEXT
    request.context.effective_permissions = ["agent.run"]
    tool = FixedProjectContextTool(request)
    executor = OperationalAgentExecutor(FixedGateway(RouteLabel.DIRECT_TOOL), FixedProvider(), tool)

    with pytest.raises(AgentExecutionError, match="TOOL_PERMISSION_REQUIRED"):
        await executor.execute(request, authorization=ExecutionAuthorization("delegation-token"))

    assert tool.token is None


async def test_direct_tool_route_requires_structured_operation() -> None:
    request = _request(model_calls=1, tool_calls=1)
    tool = FixedProjectContextTool(request)
    executor = OperationalAgentExecutor(FixedGateway(RouteLabel.DIRECT_TOOL), FixedProvider(), tool)

    with pytest.raises(AgentExecutionError, match="DIRECT_TOOL_INPUT_REQUIRED"):
        await executor.execute(request, authorization=ExecutionAuthorization("delegation-token"))

    assert tool.token is None


async def test_token_budget_failure_is_preserved_in_run_status() -> None:
    request = _request(input_tokens=5)
    executor = OperationalAgentExecutor(FixedGateway(RouteLabel.SIMPLE_LLM), FixedProvider(tokens=10))
    store = InMemoryAgentRunStore()
    coordinator = RunCoordinator(store, executor)

    await coordinator.accept(request)
    await coordinator.execute(request)
    view = await coordinator.view(request.context.run_id)

    assert view.status is AgentRunStatus.FAILED
    assert view.error_code == "INPUT_TOKEN_BUDGET_EXCEEDED"
