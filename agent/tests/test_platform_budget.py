"""인증 정보와 유료 호출 없이 금액 승인 정책을 검사한다."""

import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from contracts import (
    AgentInput,
    AgentInterruption,
    AgentRunRequest,
    AgentRunResult,
    AgentRunStatus,
    AgentWorkflowMode,
    DepartmentName,
    InterruptionKind,
    MemorySourceMessage,
    ModelSelection,
    PetProfile,
    PlatformBudget,
    ProjectContext,
    Provider,
    RunBudget,
    SafetyContextInput,
    SkillSelection,
    TrustedRunContext,
)
from platform_budget import (
    LEGACY_TARIFF_VERSION,
    TARIFF_VERSION,
    PlatformBudgetError,
    PlatformSpendLedger,
    budgeted_openai_attempt,
    current_ledger,
    platform_budget_scope,
    reject_unbounded_operation,
)
from providers import OpenAIModelProvider, ProviderNotConfiguredError, ScopedModelProvider
from routing.llm_evaluator import OpenAIRouteEvaluator, SecretSystemPrompt
from runtime import (
    ExecutionAuthorization,
    ExecutionOutcome,
    InMemoryAgentRunStore,
    OperationalAgentExecutor,
    PostgresAgentRunStore,
    RunCoordinator,
)
from runtime.run_contracts import NullCheckpointJournal
from runtime.run_state import merge_usage


def budget(amount="0.10", **updates):
    return PlatformBudget(
        reservation_id=uuid4(),
        max_cost_usd=Decimal(amount),
        tariff_version=TARIFF_VERSION,
        valid_until=datetime.now(UTC) + timedelta(hours=1)
    ).model_copy(update=updates)


def selection(model="gpt-5.6-luna", **updates):
    return ModelSelection(provider=Provider.OPENAI, model=model, **updates)


def response(input_tokens=100, output_tokens=10, cached=0, written=0, **updates):
    values = dict(
        output_text=json.dumps({"summary": "offline", "open_questions": []}),
        usage=SimpleNamespace(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            input_tokens_details=SimpleNamespace(cached_tokens=cached, cache_write_tokens=written)
        )
    )
    values.update(updates)
    return SimpleNamespace(**values)


def client(*responses):
    return SimpleNamespace(
        base_url="https://api.openai.com/v1/",
        max_retries=0,
        responses=SimpleNamespace(create=AsyncMock(side_effect=list(responses)))
    )


def payload():
    return {
        "model": "gpt-5.6-luna",
        "service_tier": "default",
        "input": [{"role": "user", "content": "offline test"}],
        "tools": [],
        "max_output_tokens": 100,
    }


def incoming():
    run_id = uuid4()
    return AgentRunRequest(
        context=TrustedRunContext(
            run_id=run_id,
            thread_id=uuid4(),
            trace_id="budget-test",
            workspace_id=uuid4(),
            project_id=uuid4(),
            initiated_by=uuid4(),
            effective_permissions=["agent.run"]
        ),
        budget=RunBudget(
            max_duration_seconds=1,
            max_model_calls=10,
            max_tool_calls=1,
            max_input_tokens=100000,
            max_output_tokens=1000,
            max_departments=1,
            max_hierarchy_depth=1
        ),
        model_selection=selection(),
        safety_context=SafetyContextInput(),
        input=AgentInput(requirement_text="Offline budget test"),
        platform_budget=budget(reservation_id=run_id)
    )


def test_wire_contract_requires_finite_money_and_aware_expiry():
    original = budget()
    assert PlatformBudget.model_validate_json(original.model_dump_json(by_alias=True)) == original
    assert '"maxCostUsd":"0.10"' in original.model_dump_json(by_alias=True)
    for updates in [{"valid_until": datetime.now()}, {"max_cost_usd": "NaN"}]:
        with pytest.raises(ValidationError):
            PlatformBudget(**{**original.model_dump(), **updates})


@pytest.mark.parametrize(
    "model, expected",
    [
        ("gpt-5.6-luna", "0.00002490"),
        ("gpt-5.6-terra", "0.00024900"),
        ("gpt-6-luna", "0.00001145"),
        ("gpt-6-sol", "0.00022900"),
        ("gpt-6.1-sol", "0.00022500"),
        ("gpt-6-astra", "0.00114500"),
        ("gpt-5.6-sol", "0.00045800"),
    ]
)
async def test_exact_tariffs_separate_cache_read_and_write(model, expected):
    ledger = PlatformSpendLedger(budget("1"))
    with platform_budget_scope(ledger):
        await OpenAIModelProvider(client(response(cached=40, written=2))).generate_structured(
            selection(model), "text", max_output_tokens=100
        )
    call = ledger.calls[0]
    assert call.usage_known and call.funding_source == "PLATFORM"
    assert call.input_tokens == 100 and call.cached_read_tokens == 40 and call.cache_write_tokens == 2
    assert call.cost_usd == Decimal(expected) <= call.reserved_cost_usd


@pytest.mark.parametrize("model", ["gpt-6.1-sol", "gpt-6-astra"])
async def test_reasoning_none_rejected_before_reservation(model):
    fake = client(response())
    ledger = PlatformSpendLedger(budget("1"))
    with platform_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="MODEL_REASONING_UNSUPPORTED"):
        await OpenAIModelProvider(fake).generate_structured(
            selection(model, reasoning_effort="NONE"), "offline", max_output_tokens=100
        )
    assert not ledger.calls
    fake.responses.create.assert_not_awaited()


async def test_old_reservation_retains_old_tariff_and_rejects_new_models():
    ledger = PlatformSpendLedger(budget("1", tariff_version=LEGACY_TARIFF_VERSION))
    with platform_budget_scope(ledger):
        await budgeted_openai_attempt(client(response()), selection(), "old", payload())
        with pytest.raises(PlatformBudgetError, match="PLATFORM_MODEL_UNPRICED"):
            ledger.reserve(selection("gpt-6-luna"), "new", {}, 100)
    assert ledger.cost == Decimal(".000032")
    prior = ledger.report(None)
    resumed = PlatformSpendLedger(ledger.budget, prior)
    assert resumed.previous_cost == prior.platform_cost_usd
    resumed.validate()


@pytest.mark.parametrize("details", [None, SimpleNamespace(cached_tokens=0), SimpleNamespace(cache_write_tokens=0)])
async def test_missing_cache_details_never_imply_free_cache_writes(details):
    usage = SimpleNamespace(input_tokens=100, output_tokens=10, input_tokens_details=details)
    ledger = PlatformSpendLedger(budget())
    with platform_budget_scope(ledger):
        await budgeted_openai_attempt(client(response(usage=usage)), selection(), "test", payload())
    assert not ledger.calls[0].usage_known
    assert ledger.cost == ledger.calls[0].reserved_cost_usd


@pytest.mark.parametrize(
    "url", ["https://eu.api.openai.com/v1", "https://api.openai.com/v1/proxy", "http://api.openai.com/v1"]
)
async def test_regional_and_custom_endpoints_are_unpriced(url):
    fake = client(response())
    fake.base_url = url
    with (
        platform_budget_scope(PlatformSpendLedger(budget())),
        pytest.raises(PlatformBudgetError, match="PLATFORM_ENDPOINT_UNPRICED"),
    ):
        await budgeted_openai_attempt(fake, selection(), "test", payload())
    fake.responses.create.assert_not_awaited()


async def test_reasoning_tokens_are_already_in_output_and_not_double_charged():
    result = response()
    result.usage.output_tokens_details = SimpleNamespace(reasoning_tokens=10)
    ledger = PlatformSpendLedger(budget())
    with platform_budget_scope(ledger):
        await budgeted_openai_attempt(client(result), selection(), "test", payload())
    assert ledger.cost == Decimal(".000032")


async def test_sdk_serialization_uses_exact_id_reasoning_and_standard_endpoint():
    import httpx
    from openai import AsyncOpenAI

    observed = []

    async def transport(request):
        observed.append((str(request.url), json.loads(request.content)))
        return httpx.Response(
            200,
            json={
                "id": "resp_offline",
                "object": "response",
                "created_at": 0,
                "model": "gpt-6.1-sol",
                "service_tier": "default",
                "status": "completed",
                "output": [],
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 10,
                    "total_tokens": 110,
                    "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
                    "output_tokens_details": {"reasoning_tokens": 10},
                },
            }
        )

    async with AsyncOpenAI(
        api_key="offline-placeholder",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport))
    ) as sdk:
        ledger = PlatformSpendLedger(budget("1"))
        body = {**payload(), "model": "gpt-6.1-sol", "reasoning": {"effort": "low"}}
        with platform_budget_scope(ledger):
            await budgeted_openai_attempt(sdk, selection("gpt-6.1-sol"), "test", body)
    assert observed == [("https://api.openai.com/v1/responses", body)]
    assert ledger.calls[0].usage_known and ledger.cost == Decimal(".00030")


async def test_attempt_bound_is_durable_before_io_and_settlement_and_close_are_recorded():
    request = incoming()
    store = InMemoryAgentRunStore()

    async def provider(**kwargs):
        running = await store.get(request.context.run_id)
        assert len(running.usage.provider_calls) == 1
        assert not running.usage.provider_calls[0].usage_known
        assert not running.usage.execution_closed
        return response()

    fake = client()
    fake.responses.create.side_effect = provider

    class Executor:
        async def execute(self, *args):
            await budgeted_openai_attempt(fake, selection(), "test", payload())
            settled = await store.get(request.context.run_id)
            assert settled.usage.provider_calls[0].usage_known
            assert not settled.usage.execution_closed
            return ExecutionOutcome(result=AgentRunResult(project_summary="offline"))

    coordinator = RunCoordinator(
        store, Executor(), require_platform_budget=True, allow_memory_platform_budget_for_tests=True
    )
    await coordinator.accept(request)
    await coordinator.execute(request)
    final = await store.get(request.context.run_id)
    assert final.usage.execution_closed and final.usage.model_calls == 1
    assert final.usage.platform_cost_usd == Decimal(".000032")


async def test_queued_cancellation_is_closed_zero_usage_without_provider_call():
    request = incoming()
    store = InMemoryAgentRunStore()
    executor = MagicMock(execute=AsyncMock())
    coordinator = RunCoordinator(
        store, executor, require_platform_budget=True, allow_memory_platform_budget_for_tests=True
    )
    await coordinator.accept(request)
    await coordinator.cancel(request.context.run_id)
    final = await store.get(request.context.run_id)
    assert final.usage.execution_closed and final.usage.model_calls == 0
    executor.execute.assert_not_awaited()


async def test_no_budget_fails_before_provider_io():
    fake = client(response())
    with pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_REQUIRED"):
        await OpenAIModelProvider(fake).generate_structured(selection(), "text", max_output_tokens=100)
    fake.responses.create.assert_not_awaited()


@pytest.mark.parametrize(
    "amount, model, expiry, version, code",
    [
        ("0.000001", "gpt-5.6-luna", 1, TARIFF_VERSION, "PLATFORM_BUDGET_EXCEEDED"),
        ("0.1", "gpt-5.6-luna-snapshot", 1, TARIFF_VERSION, "PLATFORM_MODEL_UNPRICED"),
        ("0.1", "gpt-5.6-luna", -1, TARIFF_VERSION, "PLATFORM_BUDGET_EXPIRED"),
        ("0.1", "gpt-5.6-luna", 1, "unknown", "PLATFORM_TARIFF_UNSUPPORTED"),
    ]
)
async def test_invalid_admission_never_calls_provider(amount, model, expiry, version, code):
    ledger = PlatformSpendLedger(
        budget(amount, valid_until=datetime.now(UTC) + timedelta(hours=expiry), tariff_version=version)
    )
    fake = client(response())
    with platform_budget_scope(ledger), pytest.raises(PlatformBudgetError, match=code):
        await OpenAIModelProvider(fake).generate_structured(selection(model), "text", max_output_tokens=100)
    fake.responses.create.assert_not_awaited()
    assert ledger.calls == []


async def test_legacy_byok_cannot_borrow_platform_reservation():
    credential_id = uuid4()
    ledger = PlatformSpendLedger(budget("0.000001"), run_budget=incoming().budget)
    fake = client(response())
    with platform_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="BYOK_BUDGET_REQUIRED"):
        await OpenAIModelProvider(fake, credential_id=credential_id).generate_structured(
            selection(credential_id=credential_id), "text", max_output_tokens=100
        )
    assert ledger.cost == 0 and not ledger.calls
    fake.responses.create.assert_not_awaited()


@pytest.mark.parametrize(
    "limit, code",
    [("max_model_calls", "MODEL_CALL"), ("max_input_tokens", "INPUT_TOKEN"), ("max_output_tokens", "OUTPUT_TOKEN")]
)
async def test_platform_still_enforces_pre_call_token_and_call_limits(limit, code):
    run_budget = incoming().budget.model_copy(update={limit: 0})
    ledger = PlatformSpendLedger(budget(), run_budget=run_budget)
    fake = client(response())
    with platform_budget_scope(ledger), pytest.raises(PlatformBudgetError, match=f"{code}_BUDGET_EXCEEDED"):
        await OpenAIModelProvider(fake).generate_structured(selection(), "text", max_output_tokens=100)
    fake.responses.create.assert_not_awaited()


async def test_api_and_schema_retries_have_unique_precharged_attempts():
    ledger = PlatformSpendLedger(budget())
    fake = client(TimeoutError(), response(output_text="not JSON"), response())
    with platform_budget_scope(ledger):
        await OpenAIModelProvider(fake, max_attempts=3).generate_structured(selection(), "text", max_output_tokens=100)
    assert len(ledger.calls) == len({item.call_id for item in ledger.calls}) == 3
    assert not ledger.calls[0].usage_known
    assert ledger.calls[0].cost_usd == ledger.calls[0].reserved_cost_usd
    assert all(item.usage_known for item in ledger.calls[1:])
    assert ledger.report(None).model_calls == 3


async def test_budget_exhaustion_prevents_retry_after_lost_response():
    ledger = PlatformSpendLedger(budget())

    async def lose_response(**kwargs):
        ledger.budget = ledger.budget.model_copy(update={"max_cost_usd": ledger.cost})
        raise TimeoutError()

    fake = SimpleNamespace(
        base_url="https://api.openai.com/v1/",
        max_retries=0,
        responses=SimpleNamespace(create=AsyncMock(side_effect=lose_response))
    )
    with platform_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_EXCEEDED"):
        await OpenAIModelProvider(fake).generate_structured(selection(), "text", max_output_tokens=100)
    assert fake.responses.create.await_count == len(ledger.calls) == 1


@pytest.mark.parametrize("invalid_usage", [None, SimpleNamespace(input_tokens=None, output_tokens=10)])
async def test_missing_usage_keeps_full_upper_bound(invalid_usage):
    ledger = PlatformSpendLedger(budget())
    with platform_budget_scope(ledger):
        await OpenAIModelProvider(client(response(usage=invalid_usage))).generate_structured(
            selection(), "text", max_output_tokens=100
        )
    assert ledger.cost == ledger.calls[0].reserved_cost_usd and not ledger.calls[0].usage_known


async def test_usage_above_bound_blocks_future_attempts_without_releasing_exposure():
    ledger = PlatformSpendLedger(budget())
    fake = client(response(output_tokens=101), response())
    with platform_budget_scope(ledger):
        with pytest.raises(PlatformBudgetError, match="PLATFORM_USAGE_BOUND_EXCEEDED"):
            await budgeted_openai_attempt(fake, selection(), "test", payload())
        with pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_EXCEEDED"):
            await budgeted_openai_attempt(fake, selection(), "test", payload())
    assert ledger.cost >= ledger.calls[0].reserved_cost_usd and fake.responses.create.await_count == 1


async def test_concurrent_attempts_and_cancellation_keep_one_root_reservation():
    ledger = PlatformSpendLedger(budget("0.003"))
    entered = asyncio.Event()

    async def pending(**kwargs):
        entered.set()
        await asyncio.Future()

    fake = SimpleNamespace(
        base_url="https://api.openai.com/v1/", max_retries=0, responses=SimpleNamespace(create=pending)
    )
    with platform_budget_scope(ledger):
        first = asyncio.create_task(budgeted_openai_attempt(fake, selection(), "child1", payload()))
        await entered.wait()
        with pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_EXCEEDED"):
            await budgeted_openai_attempt(fake, selection(), "child2", payload())
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
    assert len(ledger.calls) == 1 and ledger.cost == ledger.calls[0].reserved_cost_usd


async def test_platform_router_cannot_admit_mixed_byok_generation():
    credential_id = uuid4()
    ledger = PlatformSpendLedger(budget("1"))
    verdict = {
        "route": "SIMPLE_LLM",
        "abstain": False,
        "self_reported_confidence": 0.9,
        "reason_codes": ["SINGLE_RESPONSE"],
        "prompt_manipulation_detected": False,
    }
    secret = "offline route test"
    router = OpenAIRouteEvaluator(
        client(response(output_text=json.dumps(verdict))),
        SecretSystemPrompt(secret, "test-v1", hashlib.sha256(secret.encode()).hexdigest())
    )
    with platform_budget_scope(ledger):
        await router.evaluate("hello", None)
        with pytest.raises(PlatformBudgetError, match="BYOK_BUDGET_REQUIRED"):
            await OpenAIModelProvider(client(response()), credential_id=credential_id).generate_structured(
                selection("gpt-5.6-terra", credential_id=credential_id), "text", max_output_tokens=100
            )
    assert [(call.model, call.funding_source) for call in ledger.calls] == [("gpt-5.6-luna", "PLATFORM")]
    assert ledger.cost == ledger.calls[0].cost_usd


@pytest.mark.parametrize("operation", ["EMBEDDING", "RAPTOR", "WEB_RESEARCH", "A2A"])
def test_unpriced_overhead_routes_are_closed(operation):
    with platform_budget_scope(PlatformSpendLedger(budget())), pytest.raises(PlatformBudgetError):
        reject_unbounded_operation(operation)


async def test_embedding_and_platform_gemini_rejected_before_client_io():
    from retrieval.knowledge_context import OpenAIQueryEmbedder

    fake = SimpleNamespace(models=SimpleNamespace(generate_content=AsyncMock()))
    with platform_budget_scope(PlatformSpendLedger(budget())):
        with pytest.raises(PlatformBudgetError, match="PLATFORM_EMBEDDING_UNPRICED"):
            await OpenAIQueryEmbedder("text-embedding-3-small").embed("hello")
        with pytest.raises(ProviderNotConfiguredError):
            await ScopedModelProvider(fake).generate_structured(
                ModelSelection(provider=Provider.GEMINI, model="gemini"), "text", max_output_tokens=100
            )
    fake.models.generate_content.assert_not_awaited()


async def test_sdk_retries_and_multimodal_are_rejected():
    fake = client(response())
    fake.max_retries = 2
    with platform_budget_scope(PlatformSpendLedger(budget())):
        with pytest.raises(PlatformBudgetError, match="PLATFORM_SDK_RETRIES_UNBOUNDED"):
            await budgeted_openai_attempt(fake, selection(), "test", payload())
        fake.max_retries = 0
        with pytest.raises(PlatformBudgetError, match="PLATFORM_INPUT_UNBOUNDED"):
            await budgeted_openai_attempt(fake, selection(), "test", {**payload(), "tools": [{"type": "web_search"}]})
    fake.responses.create.assert_not_awaited()


async def test_coordinator_failure_ledger_and_running_replay_are_fail_closed():
    request = incoming()
    fake = client(TimeoutError())

    class Executor:
        async def execute(self, *args):
            await OpenAIModelProvider(fake, max_attempts=1).generate_structured(
                selection(), "text", max_output_tokens=100
            )

    store = InMemoryAgentRunStore()
    coordinator = RunCoordinator(
        store, Executor(), require_platform_budget=True, allow_memory_platform_budget_for_tests=True
    )
    await coordinator.accept(request)
    await coordinator.execute(request)
    view = await coordinator.view(request.context.run_id)
    assert view.status is AgentRunStatus.FAILED
    assert len(view.usage.provider_calls) == view.usage.model_calls == 1 and view.usage.platform_cost_usd > 0
    await coordinator.execute(request)
    second = incoming()
    await coordinator.accept(second)
    await store.mark_running(second.context.run_id)
    await coordinator.execute(second)
    assert (await coordinator.view(second.context.run_id)).status is AgentRunStatus.RUNNING
    assert fake.responses.create.await_count == 1


async def test_waiting_start_replay_and_stale_request_after_resume_are_rejected():
    request = incoming()
    store = InMemoryAgentRunStore()
    executor = MagicMock(execute=AsyncMock())
    coordinator = RunCoordinator(
        store, executor, require_platform_budget=True, allow_memory_platform_budget_for_tests=True
    )
    await coordinator.accept(request)
    await store.mark_running(request.context.run_id)
    await store.complete(
        request.context.run_id,
        ExecutionOutcome(
            interruption=AgentInterruption(
                interruption_id=uuid4(), kind=InterruptionKind.RISK_DECISION, questions=["why?"]
            )
        )
    )
    await coordinator.execute(request)
    assert (await coordinator.view(request.context.run_id)).status is AgentRunStatus.WAITING_FOR_USER
    # 원자적인 재개 접수 후 저장된 요청과 대기 상태를 재현한다.
    record = store._records[request.context.run_id]
    record.status = AgentRunStatus.QUEUED
    record.request = request.model_copy(update={"input": AgentInput(requirement_text="clarified request")})
    await coordinator.execute(request)
    assert (await coordinator.view(request.context.run_id)).status is AgentRunStatus.QUEUED
    executor.execute.assert_not_awaited()


async def test_expired_resumed_reservation_keeps_previous_spend():
    request = incoming()
    store = InMemoryAgentRunStore()
    executor = MagicMock(execute=AsyncMock())
    coordinator = RunCoordinator(
        store, executor, require_platform_budget=True, allow_memory_platform_budget_for_tests=True
    )
    await coordinator.accept(request)
    ledger = PlatformSpendLedger(request.platform_budget)
    with platform_budget_scope(ledger):
        await budgeted_openai_attempt(client(response()), selection(), "test", payload())
    previous = ledger.report(None)
    record = store._records[request.context.run_id]
    record.usage = previous
    request.platform_budget.valid_until = datetime.now(UTC) - timedelta(seconds=1)
    await coordinator.execute(request)
    view = await coordinator.view(request.context.run_id)
    assert view.error_code == "PLATFORM_BUDGET_EXPIRED"
    assert view.usage.platform_cost_usd == previous.platform_cost_usd and len(view.usage.provider_calls) == 1
    executor.execute.assert_not_awaited()


def test_resume_deducts_previous_spend():
    first = PlatformSpendLedger(budget("0.003"))
    first.reserve(selection(), "test", payload(), 100)
    previous = first.report(None)
    resumed = PlatformSpendLedger(first.budget, previous)
    with pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_EXCEEDED"):
        resumed.reserve(selection(), "resumed", payload(), 100)
    merged = merge_usage(previous, resumed.report(None))
    assert merged.platform_cost_usd == previous.platform_cost_usd
    assert merged.provider_calls == previous.provider_calls and merged.model_calls == 1


async def test_cancel_persists_upper_bound_before_terminal_state():
    request = incoming()
    entered = asyncio.Event()

    class Executor:
        async def execute(self, *args):
            async def pending(**kwargs):
                entered.set()
                await asyncio.Future()

            fake = SimpleNamespace(
                base_url="https://api.openai.com/v1/", max_retries=0, responses=SimpleNamespace(create=pending)
            )
            await budgeted_openai_attempt(fake, selection(), "test", payload())

    coordinator = RunCoordinator(
        InMemoryAgentRunStore(), Executor(), require_platform_budget=True, allow_memory_platform_budget_for_tests=True
    )
    await coordinator.accept(request)
    task = asyncio.create_task(coordinator.execute(request))
    await entered.wait()
    await coordinator.cancel(request.context.run_id)
    with pytest.raises(asyncio.CancelledError):
        await task
    view = await coordinator.view(request.context.run_id)
    assert view.status is AgentRunStatus.CANCELLED and view.usage.model_calls == 1
    assert view.usage.platform_cost_usd == view.usage.provider_calls[0].reserved_cost_usd


async def test_postgres_cancel_persists_attempt_report():
    database = MagicMock()
    database.session.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
    database.session.return_value.__aexit__ = AsyncMock(return_value=None)
    store = PostgresAgentRunStore(database)
    row = SimpleNamespace(status=AgentRunStatus.RUNNING.value, usage_json=None)
    store._locked = AsyncMock(return_value=row)
    store._append_event = AsyncMock()
    ledger = PlatformSpendLedger(budget())
    ledger.reserve(selection(), "test", payload(), 100)
    await store.cancel(uuid4(), ledger.report(None))
    assert row.status == AgentRunStatus.CANCELLED.value
    assert row.usage_json["platform_cost_usd"] == str(ledger.cost)


async def test_actual_runtime_requires_budget_at_admission():
    request = incoming().model_copy(update={"platform_budget": None})
    coordinator = RunCoordinator(
        InMemoryAgentRunStore(), MagicMock(), require_platform_budget=True, allow_memory_platform_budget_for_tests=True
    )
    with pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_REQUIRED"):
        await coordinator.accept(request)


async def test_terminal_checkpoint_failure_cannot_erase_provider_ledger():
    class FailedFinalCheckpoint(NullCheckpointJournal):
        async def record(self, request, status, phase, **kwargs):
            if status is AgentRunStatus.COMPLETED:
                raise RuntimeError("offline checkpoint failure")

    class Executor:
        async def execute(self, *args):
            assert current_ledger() is not None
            await budgeted_openai_attempt(client(response()), selection(), "test", payload())
            return ExecutionOutcome(result=AgentRunResult(project_summary="delivered"))

    request = incoming()
    coordinator = RunCoordinator(
        InMemoryAgentRunStore(),
        Executor(),
        FailedFinalCheckpoint(),
        require_platform_budget=True,
        allow_memory_platform_budget_for_tests=True
    )
    await coordinator.accept(request)
    await coordinator.execute(request)
    view = await coordinator.view(request.context.run_id)
    assert view.status is AgentRunStatus.COMPLETED
    assert view.usage.model_calls == 1 and view.usage.platform_cost_usd > 0


async def test_credential_binding_prevents_accidental_platform_key_fallback():
    fake = client(response())
    with (
        platform_budget_scope(PlatformSpendLedger(budget())),
        pytest.raises(PlatformBudgetError, match="BYOK_BUDGET_REQUIRED"),
    ):
        await OpenAIModelProvider(fake).generate_structured(
            selection(credential_id=uuid4()), "text", max_output_tokens=100
        )
    fake.responses.create.assert_not_awaited()


async def test_leaked_child_cannot_admit_after_root_scope_closes():
    fake = client(response())
    proceed = asyncio.Event()
    ledger = PlatformSpendLedger(budget())

    async def late_child():
        await proceed.wait()
        await budgeted_openai_attempt(fake, selection(), "leaked-child", payload())

    with platform_budget_scope(ledger):
        task = asyncio.create_task(late_child())
    proceed.set()
    with pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_SCOPE_CLOSED"):
        await task
    fake.responses.create.assert_not_awaited()


async def test_changed_provider_model_refuses_future_calls():
    ledger = PlatformSpendLedger(budget())
    fake = client(response(model="unexpected-model"))
    with platform_budget_scope(ledger):
        with pytest.raises(PlatformBudgetError, match="PLATFORM_RESPONSE_MODEL_MISMATCH"):
            await budgeted_openai_attempt(fake, selection(), "test", payload())
        with pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_EXCEEDED"):
            await budgeted_openai_attempt(fake, selection(), "test", payload())
    assert ledger.cost == ledger.calls[0].reserved_cost_usd


async def test_reservation_identity_mismatch_is_rejected_before_accept():
    request = incoming()
    request.platform_budget.reservation_id = uuid4()
    coordinator = RunCoordinator(
        InMemoryAgentRunStore(), MagicMock(), require_platform_budget=True, allow_memory_platform_budget_for_tests=True
    )
    with pytest.raises(PlatformBudgetError, match="PLATFORM_RESERVATION_MISMATCH"):
        await coordinator.accept(request)


def test_same_attempt_is_not_counted_twice_on_late_journal_error():
    ledger = PlatformSpendLedger(budget())
    ledger.reserve(selection(), "test", payload(), 100)
    report = ledger.report(None)
    merged = merge_usage(report, report)
    assert merged.model_calls == 1 and len(merged.provider_calls) == 1
    assert merged.platform_cost_usd == report.platform_cost_usd
    assert merged.input_tokens == report.input_tokens


async def test_only_pinned_standard_service_tier_is_admitted():
    ledger = PlatformSpendLedger(budget())
    fake = client(response())
    with platform_budget_scope(ledger):
        for tier in ("auto", "priority", None):
            with pytest.raises(PlatformBudgetError, match="PLATFORM_SERVICE_TIER_UNPRICED"):
                await budgeted_openai_attempt(fake, selection(), "test", {**payload(), "service_tier": tier})
        await OpenAIModelProvider(fake).generate_structured(selection(), "text", max_output_tokens=100)
    assert fake.responses.create.call_args.kwargs["service_tier"] == "default"
    assert fake.responses.create.await_count == 1


def test_long_context_cannot_use_short_context_tariff():
    ledger = PlatformSpendLedger(budget("100"))
    with pytest.raises(PlatformBudgetError, match="PLATFORM_LONG_CONTEXT_UNPRICED"):
        ledger.reserve(selection(), "test", {"input": "x" * 272000}, 100)
    assert not ledger.calls


async def test_crash_after_paid_attempt_leaves_unresumable_running_orphan():
    from contracts import ResumeAgentRunRequest, ResumeAnswer
    from runtime import AgentRunStateError

    request = incoming()
    fake = client(response())

    class CrashedExecutor:
        async def execute(self, *args):
            await budgeted_openai_attempt(fake, selection(), "test", payload())
            raise asyncio.CancelledError()  # 종료 상태 저장 전에 실행이 중단된 상황.

    store = InMemoryAgentRunStore()
    first = RunCoordinator(
        store, CrashedExecutor(), require_platform_budget=True, allow_memory_platform_budget_for_tests=True
    )
    await first.accept(request)
    with pytest.raises(asyncio.CancelledError):
        await first.execute(request)
    lost = await store.get(request.context.run_id)
    assert lost.status is AgentRunStatus.RUNNING
    assert lost.usage.model_calls == 1 and lost.usage.execution_closed
    second_executor = MagicMock(execute=AsyncMock())
    replacement = RunCoordinator(
        store, second_executor, require_platform_budget=True, allow_memory_platform_budget_for_tests=True
    )
    assert (await store.create(request)).status is AgentRunStatus.RUNNING
    await replacement.execute(request)
    with pytest.raises(AgentRunStateError):
        await replacement.accept_resume(
            request.context.run_id,
            ResumeAgentRunRequest(
                interruption_id=uuid4(),
                idempotency_key="crash-recovery-not-allowed",
                answers=[ResumeAnswer(question_index=0, answer="retry")]
            )
        )
    assert fake.responses.create.await_count == 1
    second_executor.execute.assert_not_awaited()
    await replacement.cancel(request.context.run_id)
    assert (await store.create(request)).status is AgentRunStatus.CANCELLED
    await replacement.execute(request)
    second_executor.execute.assert_not_awaited()


@pytest.mark.parametrize(
    "status",
    [AgentRunStatus.RUNNING, AgentRunStatus.WAITING_FOR_USER, AgentRunStatus.CANCELLED, AgentRunStatus.COMPLETED]
)
async def test_postgres_claim_never_requeues_or_restarts_nonqueued_run(status):
    from runtime import AgentRunStateError

    database = MagicMock()
    database.session.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
    database.session.return_value.__aexit__ = AsyncMock(return_value=None)
    store = PostgresAgentRunStore(database)
    row = SimpleNamespace(status=status.value)
    store._locked = AsyncMock(return_value=row)
    store._append_event = AsyncMock()
    with pytest.raises(AgentRunStateError):
        await store.mark_running(uuid4())
    assert row.status == status.value
    store._append_event.assert_not_awaited()


async def test_raptor_leaf_adapters_cannot_bypass_unpriced_entry_guard():
    from retrieval.provider_services import _OpenAIEmbedder, _OpenAISummarizer

    fake = MagicMock()
    with platform_budget_scope(PlatformSpendLedger(budget())):
        with pytest.raises(PlatformBudgetError, match="PLATFORM_RAPTOR_EMBEDDING_UNPRICED"):
            await _OpenAIEmbedder(fake, "unpriced").embed(["offline"])
        with pytest.raises(PlatformBudgetError, match="PLATFORM_RAPTOR_SUMMARY_UNPRICED"):
            await _OpenAISummarizer(fake, "unpriced").summarize(["offline"])
    assert fake.mock_calls == []


async def test_cross_instance_cancel_remains_bounded_without_releasing_reservation():
    request = incoming()
    first_call_done = asyncio.Event()
    proceed = asyncio.Event()
    ledger_used = []
    fake = client(response(), response())

    class Executor:
        async def execute(self, *args):
            ledger_used.append(current_ledger())
            await budgeted_openai_attempt(fake, selection(), "before-cancel", payload())
            first_call_done.set()
            await proceed.wait()
            # 다른 조정자에서는 이 로컬 작업을 취소할 수 없다.
            # 백엔드가 환급하지 않는 원래 승인 상한을 유지한다.
            await budgeted_openai_attempt(fake, selection(), "after-remote-cancel", payload())
            return ExecutionOutcome(result=AgentRunResult(project_summary="bounded"))

    store = InMemoryAgentRunStore()
    running = RunCoordinator(
        store, Executor(), require_platform_budget=True, allow_memory_platform_budget_for_tests=True
    )
    other_instance = RunCoordinator(
        store, MagicMock(), require_platform_budget=True, allow_memory_platform_budget_for_tests=True
    )
    await running.accept(request)
    task = asyncio.create_task(running.execute(request))
    await first_call_done.wait()
    await other_instance.cancel(request.context.run_id)
    proceed.set()
    await task
    assert (await store.get(request.context.run_id)).status is AgentRunStatus.CANCELLED
    assert ledger_used[0].cost <= request.platform_budget.max_cost_usd
    assert fake.responses.create.await_count == 2


async def test_expiry_is_rechecked_between_http_attempts():
    ledger = PlatformSpendLedger(budget())

    async def lost_response(**kwargs):
        ledger.budget.valid_until = datetime.now(UTC) - timedelta(seconds=1)
        raise TimeoutError()

    fake = SimpleNamespace(
        base_url="https://api.openai.com/v1/",
        max_retries=0,
        responses=SimpleNamespace(create=AsyncMock(side_effect=lost_response))
    )
    with platform_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_EXPIRED"):
        await OpenAIModelProvider(fake).generate_structured(selection(), "text", max_output_tokens=100)
    assert fake.responses.create.await_count == 1
    assert ledger.cost == ledger.calls[0].reserved_cost_usd


async def test_unknown_platform_attempt_retains_token_bound_before_retry():
    ledger = PlatformSpendLedger(budget(), run_budget=incoming().budget.model_copy(update={"max_output_tokens": 100}))
    fake = client(TimeoutError(), response())
    with platform_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="OUTPUT_TOKEN_BUDGET_EXCEEDED"):
        await OpenAIModelProvider(fake).generate_structured(selection(), "text", max_output_tokens=100)
    assert fake.responses.create.await_count == 1 and ledger.cost > 0
    assert ledger.calls[0].output_tokens == 100 and not ledger.calls[0].usage_known


async def test_nested_same_root_scope_does_not_close_parent_ledger():
    ledger = PlatformSpendLedger(budget())
    with platform_budget_scope(ledger):
        with platform_budget_scope(ledger):
            await budgeted_openai_attempt(client(response()), selection(), "child", payload())
        await budgeted_openai_attempt(client(response()), selection(), "parent", payload())
    assert len(ledger.calls) == 2 and ledger.closed


async def test_fresh_memory_store_cannot_replay_a_live_platform_reservation():
    from runtime import AgentRunNotFoundError

    request = incoming()
    executor = MagicMock(execute=AsyncMock())
    for _ in range(2):
        # 개발 서비스 재시작 시 메모리 저장소는 비어 있다.
        # 원래 요청이나 이벤트 재전달로 유료 실행기에 접근할 수 없어야 한다.
        store = InMemoryAgentRunStore()
        coordinator = RunCoordinator(store, executor, require_platform_budget=True)
        with pytest.raises(PlatformBudgetError, match="PLATFORM_DURABLE_STORE_REQUIRED"):
            await coordinator.accept(request)
        with pytest.raises(AgentRunNotFoundError):
            await store.get(request.context.run_id)
        executor.execute.assert_not_awaited()


async def test_protected_execute_cannot_bypass_durable_store_admission():
    request = incoming()
    store = InMemoryAgentRunStore()
    await store.create(request)  # 접수 검증을 거치지 않은 과거 데이터나 재전달 기록을 재현한다.
    executor = MagicMock(execute=AsyncMock())
    coordinator = RunCoordinator(store, executor, require_platform_budget=True)
    await coordinator.execute(request)
    view = await store.get(request.context.run_id)
    assert view.status is AgentRunStatus.FAILED
    assert view.error_code == "PLATFORM_DURABLE_STORE_REQUIRED"
    executor.execute.assert_not_awaited()


async def test_only_postgres_store_advertises_durable_platform_reservations():
    assert InMemoryAgentRunStore().supports_platform_reservations is False
    assert PostgresAgentRunStore(MagicMock()).supports_platform_reservations is True


async def test_budget_rejections_do_not_open_shared_provider_circuit_or_leak_capacity():
    from gateway import AIGateway, GatewayPolicy

    fake = client(response())
    gateway = AIGateway(
        OpenAIModelProvider(fake),
        policy=GatewayPolicy(max_concurrency=1, circuit_failure_threshold=3, circuit_recovery_seconds=60)
    )
    for _ in range(3):
        with (
            platform_budget_scope(PlatformSpendLedger(budget("0.000001"))),
            pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_EXCEEDED"),
        ):
            await gateway.generate_structured(selection(), "text", max_output_tokens=100)
        assert gateway.telemetry.snapshot().inflight_calls == 0
    fake.responses.create.assert_not_awaited()
    # 다른 사용자의 유효한 예약도 같은 플랫폼 공급자로 전달돼야 한다.
    with platform_budget_scope(PlatformSpendLedger(budget())):
        result = await gateway.generate_structured(selection(), "text", max_output_tokens=100)
    assert result.payload["summary"] == "offline"
    assert fake.responses.create.await_count == 1
    metrics = gateway.telemetry.snapshot()
    assert metrics.inflight_calls == 0 and metrics.failed_calls == 0
    assert metrics.rejected_calls == 3 and metrics.successful_calls == 1
    assert metrics.outcomes == {"PLATFORM_BUDGET_EXCEEDED": 3, "SUCCESS": 1}


async def test_internal_chat_progress_keeps_root_monetary_ledger_and_stops_after_terminal():
    from contracts import DepartmentName
    from runtime.internal_delegation import delegate_internal_task
    from runtime.run_contracts import ExecutionEvent
    from runtime.run_progress import publish_progress

    request = incoming()
    fake = client(response())
    store = InMemoryAgentRunStore()
    ledger_used = []

    class Executor:
        async def execute(self, *args):
            ledger_used.append(current_ledger())

            async def specialist():
                events = await store.list_events(request.context.run_id)
                assert events[-1].type == "task.delegated"
                assert current_ledger() is ledger_used[0]
                return await OpenAIModelProvider(fake).generate_structured(
                    selection(), "offline specialist", max_output_tokens=100
                )

            result = await delegate_internal_task(
                request.context.run_id,
                DepartmentName.REQUIREMENTS,
                specialist,
                lambda generated: generated.payload["summary"]
            )
            return ExecutionOutcome(result=AgentRunResult(project_summary=result.payload["summary"]))

    coordinator = RunCoordinator(
        store, Executor(), require_platform_budget=True, allow_memory_platform_budget_for_tests=True
    )
    await coordinator.accept(request)
    await coordinator.execute(request)
    view = await store.get(request.context.run_id)
    events = await store.list_events(request.context.run_id)
    task_events = [event for event in events if event.type.startswith("task.")]
    assert [event.type for event in task_events] == ["task.delegated", "task.completed"]
    assert task_events[0].data["taskId"] == task_events[1].data["taskId"]
    assert view.status is AgentRunStatus.COMPLETED
    assert len(view.usage.provider_calls) == view.usage.model_calls == 1
    assert view.usage.platform_cost_usd > 0 and ledger_used[0].closed
    await publish_progress(ExecutionEvent("task.completed", {"taskId": "late"}))
    assert await store.list_events(request.context.run_id) == events


async def test_fractional_cache_write_cost_rounds_up_like_backend_ledger():
    ledger = PlatformSpendLedger(budget("1"))
    with platform_budget_scope(ledger):
        await OpenAIModelProvider(client(response(input_tokens=1, output_tokens=0, written=1))).generate_structured(
            selection("gpt-6-luna"), "text", max_output_tokens=100
        )
    assert ledger.calls[0].usage_known
    assert ledger.calls[0].cost_usd == Decimal("0.00000013")
    assert ledger.calls[0].reserved_cost_usd.as_tuple().exponent == -8


def test_per_attempt_rounding_cannot_exceed_backend_reservation():
    # 호출당 원가는 .001025625이며 두 호출은 .00205125 안에 들어간다.
    # 백엔드는 시도마다 USD 소수점 여덟 자리로 정산하므로 반올림도 반영한다.
    ledger = PlatformSpendLedger(budget(".00205125"))
    ledger.reserve(selection("gpt-6-luna"), "test", {"a": ""}, 1)
    assert ledger.cost == Decimal(".00102563")
    with pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_EXCEEDED"):
        ledger.reserve(selection("gpt-6-luna"), "test", {"a": ""}, 1)
    assert len(ledger.calls) == 1


PROJECT_ANALYSIS_REQUIREMENT = (
    "프리랜서가 고객과 프로젝트를 관리하고 세 가지 견적안을 작성하는 웹서비스가 필요합니다. "
    "핵심 기능은 회원 로그인, 고객 목록, 프로젝트 등록, AI 질문과 답변, 견적 검토와 발행, 공유 링크입니다. "
    "펫은 친근한 설명을 돕고 근거와 가정을 구분합니다. 온라인 결제와 문자 발송은 이번 범위에서 제외합니다. "
    "고객이 제공한 자료만 사용하고 미확정 일정은 가정으로 표시해 주세요. 단가는 등록된 기준으로 서버에서 계산합니다. "
    "관리자는 발행 전 항목별 수량과 단위를 확인하고, 고객은 공유 문서를 읽을 수 있어야 합니다. "
    "승인이나 외부 전송은 자동으로 처리하지 말고 고객 확인이 필요한 부분을 별도로 알려 주세요. "
    "계약 범위와 일정의 위험을 설명하고 민감한 개인정보를 요청하지 마세요. "
    "Mobile first. Include login, projects, AI questions, PDF and share links. Use existing rates."
)

# 첫 여덟 호출의 사용량만 운영 진단 수치와 같다. 원문과 공급자 응답은 수집하지 않는다.
# 나머지 사용량과 TOOL 계약 수정 → TOOL → FINAL 응답은 명시적인 오프라인 합성 자료다.
PROJECT_ANALYSIS_USAGE = (
    (3042, 77), (3119, 60), (3730, 3117),
    (3041, 89), (3118, 65), (3729, 2240),
    (3043, 82), (3120, 67), (3731, 2600),
    (3044, 80), (3121, 65), (3732, 1900),
)


def project_analysis_reply(department, step):
    drafts = [
        {
            "scenario": scenario,
            "items": [{
                "title": title,
                "description": title,
                "quantity": hours,
                "unit": "HOUR",
                "rateCardHint": "웹 개발",
                "basis": {
                    "type": "ASSUMPTION",
                    "content": "고객의 상세 범위와 검수 기준 확인을 전제로 한 추정",
                    "sourceReference": None,
                    "sourceTitle": None,
                },
            }],
            "petPerspective": {
                "proposal": title,
                "rationale": "확인할 가정을 표시한 단계별 제안",
                "tradeoff": "추가 기능은 일정과 작업량을 늘리므로 별도 확인 필요",
            },
        }
        for scenario, title, hours in (
            ("LEAN", "로그인과 기본 견적 작성", 40),
            ("RECOMMENDED", "고객 관리와 견적 검토 및 발행", 72),
            ("EXPANDED", "권장 범위와 공유 및 접근성 검수", 96),
        )
    ] if department in {DepartmentName.REQUIREMENTS, DepartmentName.DEAL_DESIGN} and step == 2 else []
    return {
        "action": "FINAL" if step == 2 else "TOOL",
        "tool_name": None if step == 2 else "get_project_context",
        "arguments": {"query": None},
        "summary": None if step == 1 else "고객 자료에 근거한 범위와 가정 정리",
        "open_questions": [],
        "quotation_drafts": drafts,
    }


@pytest.mark.parametrize("input_limit", [50000, 100000])
async def test_default_platform_project_analysis_uses_full_payload_and_preserves_spend_guards(input_limit, monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    monkeypatch.setenv("LANGCHAIN_TRACING_V2", "false")
    from jsonschema import Draft202012Validator

    from retrieval.knowledge_context import KnowledgeContextLoader, OpenAIQueryEmbedder

    fixtures = json.loads(
        (Path(__file__).resolve().parents[2] / "contracts/fixtures/workspace-credit-contract.json").read_text()
    )
    default_budget = RunBudget.model_validate(fixtures["projectAnalysisStart"]["budget"])
    assert default_budget.max_input_tokens == 100000
    assert default_budget.max_duration_seconds == 180 and default_budget.max_model_calls == 50
    assert default_budget.max_output_tokens == 48000 and default_budget.max_tool_calls == 12
    request = incoming()
    request.budget = default_budget.model_copy(update={"max_input_tokens": input_limit})
    request.model_selection = selection("gpt-6-luna")
    request.context.effective_permissions = ["agent.run", "project.read", "document.read"]
    request.input = AgentInput(
        requirement_text=PROJECT_ANALYSIS_REQUIREMENT,
        workflow_mode=AgentWorkflowMode.PROJECT_ANALYSIS,
        jurisdiction_code="KR",
        skill_selection=SkillSelection(),
        pet_profiles=[PetProfile(
            pet_id=uuid4(), slot="RECOMMENDED", name="도움이", animal="owl", color="sage", accessory="glasses",
            tone="WARM", value_priority="BALANCED", delivery_priority="BALANCED", scope_priority="CAUTIOUS",
            preferences={"requests": [
                "친근하고 간결하게 설명하고, 필수 범위와 선택 기능을 구분하며, 없는 근거와 금액을 만들지 말아 주세요."
            ]}
        )]
    )
    # 약 1KB의 원문이 PROJECT_INPUT과 RUN_INPUT에 각각 저장된 새 프로젝트 규모다.
    assert 400 <= len(request.input.requirement_text) <= 500
    assert 1000 <= len(request.input.requirement_text.encode("utf-8")) <= 1050
    tools = AsyncMock()
    tools.get_project_context.return_value = ProjectContext(
        project_id=request.context.project_id, workspace_id=request.context.workspace_id,
        title="고객 관리와 견적 작성", requirement_text=request.input.requirement_text, currency="KRW",
        source_messages=[MemorySourceMessage(
            id=uuid4(), event_order=index, kind=kind, content=request.input.requirement_text,
            created_at=datetime.now(UTC)
        ) for index, kind in enumerate(("PROJECT_INPUT", "RUN_INPUT"), start=1)]
    )
    tools.search_knowledge.return_value = []
    router, research = AsyncMock(), AsyncMock()
    # 임베딩의 유료 호출도 운영 ledger가 차단해야 한다. SDK 생성 자체를 실패시킨다.
    ambient_sdk = MagicMock(side_effect=AssertionError("unexpected external SDK client"))
    monkeypatch.setattr("openai.AsyncOpenAI", ambient_sdk)
    store = InMemoryAgentRunStore()
    requests, bounds, ledgers = [], [], []

    async def offline_create(**body):
        ledger = current_ledger()
        assert ledger is not None
        ledgers.append(ledger)
        recorded = (await store.get(request.context.run_id)).usage.provider_calls[-1]
        bound = len(json.dumps(body, ensure_ascii=False).encode("utf-8")) + 8192
        assert recorded.input_tokens == bound and not recorded.usage_known
        assert ledger.previous_cost + ledger.cost <= request.platform_budget.max_cost_usd
        assert sum(call.input_tokens for call in ledger.calls) <= input_limit
        bounds.append(bound)
        requests.append(body)
        index = len(requests) - 1
        department = tuple(DepartmentName)[index // 3]
        reply = project_analysis_reply(department, index % 3)
        Draft202012Validator(body["text"]["format"]["schema"]).validate(reply)
        return response(
            *PROJECT_ANALYSIS_USAGE[index], output_text=json.dumps(reply, ensure_ascii=False), model="gpt-6-luna"
        )

    fake = client()
    fake.responses.create.side_effect = offline_create
    executor = OperationalAgentExecutor(
        router, OpenAIModelProvider(fake), tools, research,
        knowledge_loader=KnowledgeContextLoader(tools, OpenAIQueryEmbedder("offline-only"), "offline-only")
    )
    coordinator = RunCoordinator(
        store, executor, require_platform_budget=True, allow_memory_platform_budget_for_tests=True
    )
    await coordinator.accept(request)
    await coordinator.execute(request, ExecutionAuthorization("synthetic-offline-delegation"))
    final = await coordinator.view(request.context.run_id)
    assert final.usage.execution_closed and all(ledger.closed for ledger in ledgers)
    assert final.usage.platform_reservation_id == request.context.run_id
    assert Decimal("0") < final.usage.platform_cost_usd < request.platform_budget.max_cost_usd == Decimal("0.10")
    assert final.usage.model_calls == len(requests) == len(final.usage.provider_calls) <= 50
    assert final.usage.output_tokens <= 48000
    assert all(call.usage_known and call.cost_usd <= call.reserved_cost_usd for call in final.usage.provider_calls)
    assert {(call.operation, call.funding_source) for call in final.usage.provider_calls} == {
        ("bounded_react_step", "PLATFORM")
    }
    assert max(bounds) > 20000  # 전체 system/schema, 펫, 원문 2개와 관찰값을 포함한다.
    router.route.assert_not_awaited()
    research.collect.assert_not_awaited()
    ambient_sdk.assert_not_called()
    assert tools.search_knowledge.await_args.kwargs["request"].embedding is None
    for body in requests:
        assert body["tools"] == [] and body["store"] is False and body["service_tier"] == "default"
        prompt = body["input"][1]["content"]
        parsed = json.loads(prompt)
        assert prompt == json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
        objective = parsed["objective"]
        assert request.input.requirement_text in objective["untrusted_user_request"]
        assert objective["constraints"]["no_price_or_tax_invention"] is True
        assert objective["untrusted_pet_preferences"][0]["preferences"] == (
            request.input.pet_profiles[0].preferences.model_dump()
        )
        assert objective["builtin_skills"]["selection_rules"]
        assert "title" not in body["text"]["format"]["schema"]
    if input_limit == 50000:
        assert final.status is AgentRunStatus.FAILED and final.error_code == "INPUT_TOKEN_BUDGET_EXCEEDED"
        assert 8 <= len(requests) < 12
        assert sum(call.input_tokens for call in final.usage.provider_calls[:8]) == 25942
        assert sum(call.output_tokens for call in final.usage.provider_calls[:8]) == 5797
    else:
        assert final.status is AgentRunStatus.COMPLETED and final.error_code is None
        assert len(requests) == 12
        assert final.usage.input_tokens == sum(pair[0] for pair in PROJECT_ANALYSIS_USAGE)
        assert final.usage.output_tokens == sum(pair[1] for pair in PROJECT_ANALYSIS_USAGE)
        assert [result.department for result in final.result.department_results] == list(DepartmentName)
        assert all(result.status == "COMPLETED" for result in final.result.department_results)
        assert [draft.scenario for draft in final.result.quotation_drafts] == ["LEAN", "RECOMMENDED", "EXPANDED"]
        assert [draft.items[0].quantity for draft in final.result.quotation_drafts] == [40, 72, 96]
        assert final.result.quotation_draft.scenario == "RECOMMENDED"
        assert tools.get_project_context.await_count == 5
