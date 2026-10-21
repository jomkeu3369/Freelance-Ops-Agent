import json
from uuid import uuid4

import pytest

from contracts import (
    AgentInput,
    AgentRunRequest,
    AgentWorkflowMode,
    ModelSelection,
    PetConversation,
    PetProfile,
    ProjectContext,
    Provider,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from providers import ModelGeneration, ProviderCallError
from runtime.executor import OperationalAgentExecutor
from runtime.memory_store import InMemoryAgentRunStore
from runtime.pet_conversation import execute_conversation
from runtime.run_contracts import AgentExecutionError, ExecutionAuthorization
from runtime.run_progress import progress_scope


def request(pet_mode: bool = True, debate: bool = True) -> AgentRunRequest:
    profiles = [
        PetProfile(
            slot="RECOMMENDED",
            name=name,
            animal="cat",
            color="peach",
            accessory="none",
            tone="WARM",
            value_priority="BALANCED",
            delivery_priority="QUALITY",
            scope_priority="BALANCED",
            pet_id=uuid4()
        )
        for name in ["꼼꼼이", "든든", "차근"]
    ]
    return AgentRunRequest(
        context=TrustedRunContext(
            run_id=uuid4(),
            thread_id=uuid4(),
            trace_id="conversation-test",
            workspace_id=uuid4(),
            project_id=uuid4(),
            initiated_by=uuid4(),
            effective_permissions=["agent.run", "project.read"]
        ),
        budget=RunBudget(
            max_duration_seconds=30,
            max_model_calls=3,
            max_tool_calls=1,
            max_input_tokens=150000,
            max_output_tokens=12000,
            max_departments=1,
            max_hierarchy_depth=1
        ),
        model_selection=ModelSelection(provider=Provider.OPENAI, model="synthetic-model"),
        safety_context=SafetyContextInput(),
        input=AgentInput(
            requirement_text="예약 기능과 결제의 범위를 같이 정하자",
            workflow_mode=AgentWorkflowMode.AD_HOC,
            pet_profiles=profiles,
            conversation=PetConversation(pet_mode=pet_mode, debate_enabled=debate)
        )
    )


def project(run: AgentRunRequest) -> ProjectContext:
    return ProjectContext(
        project_id=run.context.project_id,
        workspace_id=run.context.workspace_id,
        title="예약 사이트",
        requirement_text="예산과 일정을 확인한다",
        currency="KRW"
    )


class ProviderStub:
    def __init__(self, fail_at: int = 0, invalid_evidence: bool = False) -> None:
        self.prompts: list[dict[str, object]] = []
        self.fail_at = fail_at
        self.invalid_evidence = invalid_evidence

    async def generate_structured(self, selection: object, prompt: str, *, max_output_tokens: int, max_attempts: int = 1 ) -> ModelGeneration:  # noqa: E501
        del selection, max_output_tokens
        assert max_attempts == 1
        self.prompts.append(json.loads(prompt))
        if len(self.prompts) == self.fail_at:
            raise ProviderCallError("synthetic error", model_calls=1, input_tokens=12, output_tokens=2)
        return ModelGeneration(
            payload={
                "summary": "실제 모델 응답을 대체하는 테스트 결과",
                "evidence_refs": ["unknown" if self.invalid_evidence else "project"],
            },
            input_tokens=10,
            output_tokens=20
        )


async def test_three_real_generations_see_earlier_replies_and_publish_completed_messages() -> None:
    run = request()
    provider = ProviderStub()
    store = InMemoryAgentRunStore()
    await store.create(run)
    await store.mark_running(run.context.run_id)

    async def persist(event: object) -> None:
        await store.append_progress(run.context.run_id, event)

    with progress_scope(persist):
        outcome = await execute_conversation(provider, run, project(run), run.input.requirement_text)
    assert [len(prompt["earlier_speakers"]) for prompt in provider.prompts] == [0, 1, 2]
    assert [prompt["conversation_turn"]["number"] for prompt in provider.prompts] == [1, 2, 3]
    assert all(prompt["conversation_turn"]["count"] == 3 for prompt in provider.prompts)
    assert [pet["name"] for pet in provider.prompts[2]["participants"]] == ["꼼꼼이", "든든", "차근"]
    assert outcome.usage.model_calls == 3
    assert len(outcome.result.pet_messages) == 3
    assert outcome.result.pet_messages[1].reply_to_message_id == outcome.result.pet_messages[0].message_id
    assert outcome.result.quotation_draft is None
    # 진행 발화도 결과 스냅샷에 보관하여 취소 후 GET과 새로고침에서 읽는다.
    await store.cancel(run.context.run_id)
    recovered = await store.get(run.context.run_id)
    assert recovered.result.pet_messages == outcome.result.pet_messages
    assert (
        len([event for event in await store.list_events(run.context.run_id) if event.type == "pet.message.completed"])
        == 3
    )


@pytest.mark.parametrize("pet_mode,debate", [(False, True), (True, False)])
async def test_mode_switches_limit_real_model_calls_and_speakers(pet_mode: bool, debate: bool) -> None:
    run = request(pet_mode, debate)
    provider = ProviderStub()
    result = await execute_conversation(provider, run, project(run), run.input.requirement_text)
    assert len(provider.prompts) == len(result.result.pet_messages) == 1
    assert (result.result.pet_messages[0].speaker is not None) == pet_mode
    assert provider.prompts[0]["pet_mode"] == pet_mode


async def test_named_recipient_is_the_only_speaker() -> None:
    run = request()
    run.input.conversation.recipient_pet_id = run.input.pet_profiles[1].pet_id
    provider = ProviderStub()
    result = await execute_conversation(provider, run, project(run), run.input.requirement_text)
    assert len(provider.prompts) == 1
    assert result.result.pet_messages[0].speaker_pet_id == run.input.pet_profiles[1].pet_id


async def test_failed_second_pet_preserves_first_message_and_all_call_usage() -> None:
    run = request()
    result = await execute_conversation(ProviderStub(fail_at=2), run, project(run), run.input.requirement_text)
    assert result.partial_error_code == "MODEL_PROVIDER_FAILED"
    assert len(result.result.pet_messages) == 1
    assert result.usage.model_calls == 2
    assert result.usage.input_tokens == 22


async def test_unknown_evidence_is_never_presented_as_a_real_source() -> None:
    run = request()
    with pytest.raises(AgentExecutionError):
        await execute_conversation(ProviderStub(invalid_evidence=True), run, project(run), run.input.requirement_text)


async def test_call_budget_is_shared_by_the_team_and_checked_before_a_call() -> None:
    run = request()
    run.budget.max_model_calls = 2
    provider = ProviderStub()
    with pytest.raises(AgentExecutionError, match="MODEL_CALL_BUDGET_EXCEEDED"):
        await execute_conversation(provider, run, project(run), run.input.requirement_text)
    assert provider.prompts == []


async def test_unselected_recipient_cannot_impersonate_a_pet() -> None:
    run = request()
    run.input.conversation.recipient_pet_id = uuid4()
    provider = ProviderStub()
    with pytest.raises(AgentExecutionError, match="CONVERSATION_PET_UNAVAILABLE"):
        await execute_conversation(provider, run, project(run), run.input.requirement_text)
    assert provider.prompts == []


async def test_operational_executor_uses_authenticated_project_context_without_rerouting() -> None:
    run = request()
    provider = ProviderStub()

    class Gateway:
        async def route(self, *args: object) -> None:
            raise AssertionError("Conversation must not spend a router call")

    class Tool:
        async def get_project_context(self, token: str, **kwargs: object) -> ProjectContext:
            assert token == "scoped-token"
            assert kwargs["run_id"] == run.context.run_id
            return project(run)

    outcome = await OperationalAgentExecutor(Gateway(), provider, Tool()).execute(
        run, authorization=ExecutionAuthorization("scoped-token")
    )
    assert outcome.usage.model_calls == 3
    assert outcome.usage.tool_calls == 1
    assert len(outcome.result.pet_messages) == 3
    assert provider.prompts[0]["project"]["project_id"] == str(run.context.project_id)


async def test_large_public_replies_do_not_break_the_summary_contract() -> None:
    run = request()

    class LongProvider(ProviderStub):
        async def generate_structured(self, *args: object, **kwargs: object) -> ModelGeneration:
            return ModelGeneration(payload={"summary": "답변 " * 3000}, input_tokens=10, output_tokens=20)

    result = await execute_conversation(LongProvider(), run, project(run), run.input.requirement_text)
    assert len(result.result.pet_messages) == 3
    assert len(result.result.project_summary) == 10000


async def test_accepted_scope_and_assumptions_remain_in_the_next_model_context() -> None:
    run = request(debate=False)
    run.input.conversation.accepted_draft = {"items": [{
        "title": "예약 개발", "quantity": 18, "unit": "HOUR",
        "description": "이메일 알림만 포함한다", "basis": {"content": "문자 발송과 결제는 제외한다"}
    }, {
        "title": "관리자 화면", "quantity": 1, "unit": "DAY",
        "description": "수동 확정과 취소", "basis": {"content": "기본 템플릿을 사용한다"}
    }]}
    provider = ProviderStub()
    await execute_conversation(provider, run, project(run), run.input.requirement_text)
    assert provider.prompts[0]["accepted_draft"] == run.input.conversation.accepted_draft
    assert provider.prompts[0]["accepted_draft"]["items"][0]["description"] == "이메일 알림만 포함한다"
    assert provider.prompts[0]["accepted_draft"]["items"][0]["basis"]["content"] == "문자 발송과 결제는 제외한다"


async def test_model_price_guesses_are_never_published_or_passed_to_the_next_speaker() -> None:
    run = request()

    class PriceProvider(ProviderStub):
        async def generate_structured(self, selection: object, prompt: str, **kwargs: object) -> ModelGeneration:
            self.prompts.append(json.loads(prompt))
            return ModelGeneration(payload={
                "summary": "결제를 2차로 미루자. 부가세 포함 277만7,500원입니다. 예약 API는 1.5일로 가정해.",
                "open_questions": ["예산 300만원 이내일까요?", "중복 신청을 막아야 할까?"]
            })

    provider = PriceProvider()
    outcome = await execute_conversation(provider, run, project(run), run.input.requirement_text)
    assert len(outcome.result.pet_messages) == 3
    assert all("277" not in message.text and "1.5일" in message.text for message in outcome.result.pet_messages)
    assert "277" not in json.dumps(provider.prompts[1]["earlier_speakers"])
    assert outcome.result.open_questions == ["중복 신청을 막아야 할까?"]


async def test_resolved_questions_are_replaced_instead_of_accumulated() -> None:
    run = request()

    class QuestionProvider(ProviderStub):
        async def generate_structured(self, selection: object, prompt: str, **kwargs: object) -> ModelGeneration:
            self.prompts.append(json.loads(prompt))
            return ModelGeneration(payload={
                "summary": "결제를 다음 단계로 미루고 예약 신청만 남기자.",
                "open_questions": ["결제도 넣을까?"] if len(self.prompts) == 1 else []
            })

    provider = QuestionProvider()
    outcome = await execute_conversation(provider, run, project(run), run.input.requirement_text)
    assert provider.prompts[1]["unresolved_questions"] == ["결제도 넣을까?"]
    assert provider.prompts[2]["unresolved_questions"] == []
    assert outcome.result.open_questions == []
