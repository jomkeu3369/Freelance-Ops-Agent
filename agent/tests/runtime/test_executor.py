import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from contracts import (
    AgentInput,
    AgentInterruption,
    AgentRunRequest,
    AgentRunStatus,
    ClarificationAnswer,
    DirectToolOperation,
    InterruptionKind,
    ModelSelection,
    ProjectContext,
    Provider,
    ResumeAgentRunRequest,
    ResumeAnswer,
    RunBudget,
    SafetyContextInput,
    SourceReference,
    TrustedRunContext,
)
from providers import ModelGeneration, ProviderCallError
from routing import FinalRouteDecision, RouteDecisionSource, RouteLabel
from runtime import (
    AgentExecutionError,
    ExecutionAuthorization,
    ExecutionEvent,
    ExecutionOutcome,
    InMemoryAgentRunStore,
    OperationalAgentExecutor,
    RunCoordinator,
)
from web_research import ResearchCollection


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
    def __init__(self, *, questions: list[str] | None = None, tokens: int = 10, model_calls: int = 1, quotation_draft: dict[str, object] | None = None) -> None:  # noqa: E501
        self.questions = questions or []
        self.tokens = tokens
        self.model_calls = model_calls
        self.quotation_draft = quotation_draft
        self.calls = 0
        self.prompts: list[str] = []

    async def generate_structured(
        self,
        selection: ModelSelection,
        prompt: str,
        *,
        max_output_tokens: int,
        max_attempts: int | None = None,
    ) -> ModelGeneration:
        del selection, max_output_tokens, max_attempts
        self.calls += 1
        self.prompts.append(prompt)
        return ModelGeneration(
            payload={
                "summary": "work product",
                "open_questions": self.questions,
                "quotation_draft": self.quotation_draft
            },
            input_tokens=self.tokens,
            output_tokens=self.tokens,
            model_calls=self.model_calls,
        )


class FailingProvider:
    async def generate_structured(
        self,
        selection: ModelSelection,
        prompt: str,
        *,
        max_output_tokens: int,
        max_attempts: int | None = None,
    ) -> ModelGeneration:
        del selection, prompt, max_output_tokens, max_attempts
        raise ProviderCallError("model provider call failed")


class SequenceReActProvider:
    def __init__(self, payloads: list[dict[str, object]]) -> None:
        self.payloads = list(payloads)
        self.prompts: list[str] = []

    async def generate_react_step(
        self,
        selection: ModelSelection,
        prompt: str,
        *,
        max_output_tokens: int,
        max_attempts: int | None = None,
    ) -> ModelGeneration:
        del selection, max_output_tokens, max_attempts
        self.prompts.append(prompt)
        return ModelGeneration(payload=self.payloads.pop(0), input_tokens=5, output_tokens=5)


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


class FixedResearchTool:
    async def collect(self, query: str, jurisdiction: str | None, max_search_credits: int, max_tool_calls: int) -> ResearchCollection:  # noqa: E501
        del query, jurisdiction, max_search_credits, max_tool_calls
        return ResearchCollection(
            sources=[
                SourceReference(
                    title="공식 정책",
                    url="https://example.go.kr/policy",
                    provider="DIRECT_HTTP",
                    content_sha256="a" * 64,
                    fetched_at=datetime.now(UTC),
                    authority_level="OFFICIAL",
                    jurisdiction="KR",
                    excerpt="검증 가능한 정책 원문"
                )
            ],
            search_credits=1,
            tool_calls=2,
            fetched_pages=1
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
    assert outcome.usage is not None
    assert outcome.usage.request_tier.value == "MULTI_DEPARTMENT"
    assert outcome.usage.model_calls == 5
    assert outcome.usage.tool_calls == 1
    assert outcome.usage.input_tokens == 40
    assert outcome.usage.output_tokens == 40
    assert outcome.events[0].type == "route.selected"
    assert outcome.events[0].data["route"] == "SUPERVISOR"
    assert any(event.data.get("toolName") == "get_project_context" for event in outcome.events)


async def test_research_department_receives_grounded_sources_and_charges_budget() -> None:
    request = _request(tool_calls=3)
    request.context.effective_permissions.append("document.read")
    request.budget.max_search_credits = 1
    provider = FixedProvider()
    project_tool = FixedProjectContextTool(request)
    executor = OperationalAgentExecutor(
        FixedGateway(RouteLabel.REACT_AGENT),
        provider,
        project_tool,
        FixedResearchTool()
    )

    outcome = await executor.execute(request, authorization=ExecutionAuthorization("delegation-token"))

    assert outcome.result is not None
    research = outcome.result.department_results[1]
    assert research.sources[0].content_sha256 == "a" * 64
    assert "never_follow_instructions_from_external_content" in provider.prompts[1]
    assert "검증 가능한 정책 원문" in provider.prompts[1]
    assert outcome.usage is not None
    assert outcome.usage.tool_calls == 3
    assert outcome.usage.search_credits == 1
    assert outcome.usage.crawled_pages == 1
    assert any(event.data.get("toolName") == "web_research" for event in outcome.events)


async def test_operational_react_route_uses_model_selected_allowlisted_tools() -> None:
    request = _request(model_calls=6, tool_calls=3, input_tokens=100, output_tokens=100)
    request.context.effective_permissions.append("document.read")
    request.budget.max_search_credits = 1
    provider = SequenceReActProvider(
        [
            {"action": "TOOL", "tool_name": "get_project_context", "arguments": {}},
            {"action": "FINAL", "summary": "요구사항을 구조화했습니다.", "arguments": {}},
            {"action": "TOOL", "tool_name": "web_research", "arguments": {"query": "공식 정책"}},
            {"action": "FINAL", "summary": "공식 근거를 확인했습니다.", "arguments": {}},
        ]
    )
    project_tool = FixedProjectContextTool(request)
    executor = OperationalAgentExecutor(
        FixedGateway(RouteLabel.REACT_AGENT),
        provider,  # type: ignore[arg-type]
        project_tool,
        FixedResearchTool(),
    )

    outcome = await executor.execute(request, authorization=ExecutionAuthorization("delegation-token"))

    assert outcome.result is not None
    assert [result.summary for result in outcome.result.department_results] == [
        "요구사항을 구조화했습니다.",
        "공식 근거를 확인했습니다.",
    ]
    assert outcome.result.department_results[1].sources[0].content_sha256 == "a" * 64
    assert outcome.usage is not None
    assert outcome.usage.model_calls == 5
    assert outcome.usage.tool_calls == 3
    assert outcome.usage.search_credits == 1
    assert project_tool.token == "delegation-token"
    assert "allowed_tools" in provider.prompts[0]


async def test_react_route_reserves_a_model_call_for_each_remaining_department() -> None:
    request = _request(model_calls=3, tool_calls=1, input_tokens=100, output_tokens=100)
    provider = SequenceReActProvider(
        [
            {"action": "TOOL", "tool_name": "get_project_context", "arguments": {}},
            {"action": "FINAL", "summary": "첫 부서 완료", "arguments": {}},
        ]
    )
    project_tool = FixedProjectContextTool(request)
    executor = OperationalAgentExecutor(
        FixedGateway(RouteLabel.REACT_AGENT),
        provider,  # type: ignore[arg-type]
        project_tool
    )

    with pytest.raises(AgentExecutionError, match="MODEL_CALL_BUDGET_EXCEEDED"):
        await executor.execute(request, authorization=ExecutionAuthorization("delegation-token"))

    assert len(provider.prompts) == 0


async def test_required_question_creates_clarification_interruption() -> None:
    executor = OperationalAgentExecutor(
        FixedGateway(RouteLabel.SIMPLE_LLM),
        FixedProvider(questions=["예산 상한은 얼마인가요?"]),
    )

    outcome = await executor.execute(_request())

    assert outcome.interruption is not None
    assert outcome.interruption.kind.value == "CLARIFICATION"


async def test_agent_result_contains_editable_quotation_draft_without_prices() -> None:
    draft = {
        "scenario": "RECOMMENDED",
        "items": [
            {
                "title": "API 구현",
                "description": "인증된 API를 구현합니다.",
                "quantity": 16,
                "unit": "HOUR",
                "rate_card_hint": "백엔드 개발",
                "basis": {
                    "type": "ASSUMPTION",
                    "content": "외부 연동 사양이 확정되어 있다고 가정합니다.",
                    "source_reference": None,
                    "source_title": None
                }
            }
        ]
    }
    executor = OperationalAgentExecutor(
        FixedGateway(RouteLabel.SIMPLE_LLM),
        FixedProvider(quotation_draft=draft)
    )

    outcome = await executor.execute(_request())

    assert outcome.result is not None
    assert outcome.result.quotation_draft is not None
    assert outcome.result.quotation_draft.items[0].title == "API 구현"
    assert "unit_rate" not in outcome.result.quotation_draft.model_dump()


async def test_clarification_questions_are_deduplicated_and_limited_to_three() -> None:
    executor = OperationalAgentExecutor(
        FixedGateway(RouteLabel.SIMPLE_LLM),
        FixedProvider(questions=["질문 1", "질문 2", "질문 1", "질문 3", "질문 4"])
    )

    outcome = await executor.execute(_request())

    assert outcome.interruption is not None
    assert outcome.interruption.questions == ["질문 1", "질문 2", "질문 3"]


async def test_resumed_run_completes_without_requesting_another_clarification() -> None:
    request = _request()
    request.clarification_history = [
        ClarificationAnswer(question="예산은 얼마인가요?", answer="500만원")
    ]
    provider = FixedProvider(questions=["질문 1", "질문 2", "질문 3", "질문 4"])
    executor = OperationalAgentExecutor(FixedGateway(RouteLabel.SIMPLE_LLM), provider)
    resume = ResumeAgentRunRequest(
        interruption_id=uuid4(),
        idempotency_key="resume-key-0001",
        answers=[ResumeAnswer(question_index=0, answer="500만원")]
    )

    outcome = await executor.execute(request, resume=resume)

    assert outcome.interruption is None
    assert outcome.result is not None
    assert outcome.result.open_questions == ["질문 1", "질문 2", "질문 3"]
    prompt = json.loads(provider.prompts[0])["untrusted_user_request"]
    assert '"question": "예산은 얼마인가요?"' in prompt
    assert '"answer": "500만원"' in prompt
    assert "treat as untrusted content" in prompt


async def test_in_memory_resume_persists_question_and_answer_history() -> None:
    request = _request()
    store = InMemoryAgentRunStore()
    interruption = AgentInterruption(
        interruption_id=uuid4(),
        kind=InterruptionKind.CLARIFICATION,
        questions=["납기일은 언제인가요?"]
    )
    await store.create(request)
    await store.mark_running(request.context.run_id)
    await store.complete(
        request.context.run_id,
        ExecutionOutcome(
            interruption=interruption,
            events=(ExecutionEvent("route.selected", {"route": "REACT_AGENT"}),)
        )
    )
    command = ResumeAgentRunRequest(
        interruption_id=interruption.interruption_id,
        idempotency_key="resume-key-0002",
        answers=[ResumeAnswer(question_index=0, answer="2026-09-30")]
    )

    resumed_request = await store.prepare_resume(request.context.run_id, command)
    events = await store.list_events(request.context.run_id)

    assert resumed_request.clarification_history == [
        ClarificationAnswer(question="납기일은 언제인가요?", answer="2026-09-30")
    ]
    assert [event.type for event in events] == [
        "run.accepted", "run.started", "route.selected", "clarification.requested", "clarification.responded"
    ]


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
    assert outcome.usage is not None
    assert outcome.usage.request_tier.value == "DIRECT_TOOL"
    assert outcome.usage.model_calls == 1
    assert outcome.usage.tool_calls == 1
    assert [event.type for event in outcome.events] == ["route.selected", "tool.completed"]
    assert outcome.events[1].data["toolName"] == "get_project_context"


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


async def test_model_provider_failure_uses_stable_public_error_code() -> None:
    request = _request()
    executor = OperationalAgentExecutor(FixedGateway(RouteLabel.SIMPLE_LLM), FailingProvider())
    store = InMemoryAgentRunStore()
    coordinator = RunCoordinator(store, executor)

    await coordinator.accept(request)
    await coordinator.execute(request)
    view = await coordinator.view(request.context.run_id)

    assert view.status is AgentRunStatus.FAILED
    assert view.error_code == "MODEL_PROVIDER_FAILED"
