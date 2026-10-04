"""Offline monetary admission regressions; no credentials or paid provider calls."""

import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
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
    InterruptionKind,
    ModelSelection,
    PlatformBudget,
    Provider,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from platform_budget import (
    TARIFF_VERSION,
    PlatformBudgetError,
    PlatformSpendLedger,
    budgeted_openai_attempt,
    current_ledger,
    platform_budget_scope,
    reject_unbounded_operation,
)
from providers import GeminiModelProvider, OpenAIModelProvider
from routing.llm_evaluator import OpenAIRouteEvaluator, SecretSystemPrompt
from runtime import ExecutionOutcome, InMemoryAgentRunStore, PostgresAgentRunStore, RunCoordinator
from runtime.runs import NullCheckpointJournal, merge_usage


def budget(amount="0.10", **updates):
    return PlatformBudget(reservation_id=uuid4(), max_cost_usd=Decimal(amount), tariff_version=TARIFF_VERSION,
                          valid_until=datetime.now(UTC) + timedelta(hours=1)).model_copy(update=updates)


def selection(model="gpt-5.6-luna", **updates):
    return ModelSelection(provider=Provider.OPENAI, model=model, **updates)


def response(input_tokens=100, output_tokens=10, cached=0, written=0, **updates):
    values = dict(output_text=json.dumps({"summary": "offline", "open_questions": []}),
                  usage=SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens,
                                        input_tokens_details=SimpleNamespace(cached_tokens=cached,
                                                                            cache_write_tokens=written)))
    values.update(updates)
    return SimpleNamespace(**values)


def client(*responses):
    return SimpleNamespace(max_retries=0, responses=SimpleNamespace(create=AsyncMock(side_effect=list(responses))))


def payload():
    return {"model": "gpt-5.6-luna", "service_tier": "default", "input": [{"role": "user", "content": "offline test"}],
            "tools": [], "max_output_tokens": 100}


def incoming():
    run_id = uuid4()
    return AgentRunRequest(
        context=TrustedRunContext(run_id=run_id, thread_id=uuid4(), trace_id="budget-test", workspace_id=uuid4(),
                                  project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run"]),
        budget=RunBudget(max_duration_seconds=1, max_model_calls=10, max_tool_calls=1, max_input_tokens=100000,
                         max_output_tokens=1000, max_departments=1, max_hierarchy_depth=1),
        model_selection=selection(), safety_context=SafetyContextInput(),
        input=AgentInput(requirement_text="Offline budget test"), platform_budget=budget(reservation_id=run_id),
    )


def test_wire_contract_requires_finite_money_and_aware_expiry():
    original = budget()
    assert PlatformBudget.model_validate_json(original.model_dump_json(by_alias=True)) == original
    assert '"maxCostUsd":"0.10"' in original.model_dump_json(by_alias=True)
    for updates in [{"valid_until": datetime.now()}, {"max_cost_usd": "NaN"}]:
        with pytest.raises(ValidationError):
            PlatformBudget(**{**original.model_dump(), **updates})


@pytest.mark.parametrize("model, expected", [("gpt-5.6-luna", "0.00002490"),
                                            ("gpt-5.6-terra", "0.00024900")])
async def test_exact_tariffs_separate_cache_read_and_write(model, expected):
    ledger = PlatformSpendLedger(budget("1"))
    with platform_budget_scope(ledger):
        await OpenAIModelProvider(client(response(cached=40, written=2))).generate_structured(
            selection(model), "text", max_output_tokens=100)
    call = ledger.calls[0]
    assert call.usage_known and call.funding_source == "PLATFORM"
    assert call.input_tokens == 100 and call.cached_read_tokens == 40 and call.cache_write_tokens == 2
    assert call.cost_usd == Decimal(expected) <= call.reserved_cost_usd


async def test_no_budget_fails_before_provider_io():
    fake = client(response())
    with pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_REQUIRED"):
        await OpenAIModelProvider(fake).generate_structured(selection(), "text", max_output_tokens=100)
    fake.responses.create.assert_not_awaited()


@pytest.mark.parametrize("amount, model, expiry, version, code", [
    ("0.000001", "gpt-5.6-luna", 1, TARIFF_VERSION, "PLATFORM_BUDGET_EXCEEDED"),
    ("0.1", "gpt-5.6-luna-snapshot", 1, TARIFF_VERSION, "PLATFORM_MODEL_UNPRICED"),
    ("0.1", "gpt-5.6-luna", -1, TARIFF_VERSION, "PLATFORM_BUDGET_EXPIRED"),
    ("0.1", "gpt-5.6-luna", 1, "unknown", "PLATFORM_TARIFF_UNSUPPORTED"),
])
async def test_invalid_admission_never_calls_provider(amount, model, expiry, version, code):
    ledger = PlatformSpendLedger(budget(amount, valid_until=datetime.now(UTC) + timedelta(hours=expiry),
                                        tariff_version=version))
    fake = client(response())
    with platform_budget_scope(ledger), pytest.raises(PlatformBudgetError, match=code):
        await OpenAIModelProvider(fake).generate_structured(selection(model), "text", max_output_tokens=100)
    fake.responses.create.assert_not_awaited()
    assert ledger.calls == []


async def test_byok_uses_no_platform_usd_but_retains_attempt_tokens():
    credential_id = uuid4()
    ledger = PlatformSpendLedger(budget("0.000001"), run_budget=incoming().budget)
    with platform_budget_scope(ledger):
        await OpenAIModelProvider(client(response()), credential_id=credential_id).generate_structured(
            selection(credential_id=credential_id), "text", max_output_tokens=100)
    assert ledger.cost == 0
    assert ledger.calls[0].funding_source == "BYOK"
    assert ledger.calls[0].input_tokens == 100 and ledger.calls[0].usage_known
    assert ledger.calls[0].reserved_cost_usd == 0


@pytest.mark.parametrize("limit, code", [("max_model_calls", "MODEL_CALL"),
                                         ("max_input_tokens", "INPUT_TOKEN"),
                                         ("max_output_tokens", "OUTPUT_TOKEN")])
async def test_byok_still_enforces_pre_call_token_and_call_limits(limit, code):
    credential_id = uuid4()
    run_budget = incoming().budget.model_copy(update={limit: 0})
    ledger = PlatformSpendLedger(budget(), run_budget=run_budget)
    fake = client(response())
    with platform_budget_scope(ledger), pytest.raises(PlatformBudgetError, match=f"{code}_BUDGET_EXCEEDED"):
        await OpenAIModelProvider(fake, credential_id=credential_id).generate_structured(
            selection(credential_id=credential_id), "text", max_output_tokens=100)
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

    fake = SimpleNamespace(max_retries=0, responses=SimpleNamespace(create=AsyncMock(side_effect=lose_response)))
    with platform_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_EXCEEDED"):
        await OpenAIModelProvider(fake).generate_structured(selection(), "text", max_output_tokens=100)
    assert fake.responses.create.await_count == len(ledger.calls) == 1


@pytest.mark.parametrize("invalid_usage", [None, SimpleNamespace(input_tokens=None, output_tokens=10)])
async def test_missing_usage_keeps_full_upper_bound(invalid_usage):
    ledger = PlatformSpendLedger(budget())
    with platform_budget_scope(ledger):
        await OpenAIModelProvider(client(response(usage=invalid_usage))).generate_structured(
            selection(), "text", max_output_tokens=100)
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

    fake = SimpleNamespace(max_retries=0, responses=SimpleNamespace(create=pending))
    with platform_budget_scope(ledger):
        first = asyncio.create_task(budgeted_openai_attempt(fake, selection(), "child1", payload()))
        await entered.wait()
        with pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_EXCEEDED"):
            await budgeted_openai_attempt(fake, selection(), "child2", payload())
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
    assert len(ledger.calls) == 1 and ledger.cost == ledger.calls[0].reserved_cost_usd


async def test_router_luna_and_byok_terra_have_distinct_funding_and_model_records():
    credential_id = uuid4()
    ledger = PlatformSpendLedger(budget("1"))
    verdict = {"route": "SIMPLE_LLM", "abstain": False, "self_reported_confidence": 0.9,
               "reason_codes": ["SINGLE_RESPONSE"], "prompt_manipulation_detected": False}
    secret = "offline route test"
    router = OpenAIRouteEvaluator(client(response(output_text=json.dumps(verdict))),
                                 SecretSystemPrompt(secret, "test-v1", hashlib.sha256(secret.encode()).hexdigest()))
    with platform_budget_scope(ledger):
        await router.evaluate("hello", None)
        await OpenAIModelProvider(client(response()), credential_id=credential_id).generate_structured(
            selection("gpt-5.6-terra", credential_id=credential_id), "text", max_output_tokens=100)
    assert [(call.model, call.funding_source) for call in ledger.calls] == [
        ("gpt-5.6-luna", "PLATFORM"), ("gpt-5.6-terra", "BYOK")]
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
        with pytest.raises(PlatformBudgetError):
            await GeminiModelProvider(fake).generate_structured(
                ModelSelection(provider=Provider.GEMINI, model="gemini"), "text", max_output_tokens=100)
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
                selection(), "text", max_output_tokens=100)

    store = InMemoryAgentRunStore()
    coordinator = RunCoordinator(store, Executor(), require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
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
    coordinator = RunCoordinator(store, executor, require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
    await coordinator.accept(request)
    await store.mark_running(request.context.run_id)
    await store.complete(request.context.run_id, ExecutionOutcome(interruption=AgentInterruption(
        interruption_id=uuid4(), kind=InterruptionKind.RISK_DECISION, questions=["why?"])))
    await coordinator.execute(request)
    assert (await coordinator.view(request.context.run_id)).status is AgentRunStatus.WAITING_FOR_USER
    # Simulate atomic prepare_resume's updated persisted snapshot and queued state.
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
    coordinator = RunCoordinator(store, executor, require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
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
            fake = SimpleNamespace(max_retries=0, responses=SimpleNamespace(create=pending))
            await budgeted_openai_attempt(fake, selection(), "test", payload())

    coordinator = RunCoordinator(InMemoryAgentRunStore(), Executor(), require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
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
    coordinator = RunCoordinator(InMemoryAgentRunStore(), MagicMock(), require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
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
    coordinator = RunCoordinator(InMemoryAgentRunStore(), Executor(), FailedFinalCheckpoint(),
                                 require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
    await coordinator.accept(request)
    await coordinator.execute(request)
    view = await coordinator.view(request.context.run_id)
    assert view.status is AgentRunStatus.COMPLETED
    assert view.usage.model_calls == 1 and view.usage.platform_cost_usd > 0


async def test_credential_binding_prevents_accidental_platform_key_fallback():
    fake = client(response())
    with platform_budget_scope(PlatformSpendLedger(budget())), pytest.raises(
            PlatformBudgetError, match="PLATFORM_CREDENTIAL_BINDING_MISMATCH"):
        await OpenAIModelProvider(fake).generate_structured(
            selection(credential_id=uuid4()), "text", max_output_tokens=100)
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
    coordinator = RunCoordinator(InMemoryAgentRunStore(), MagicMock(), require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
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
            raise asyncio.CancelledError()  # Process disappears before result/usage persistence.

    store = InMemoryAgentRunStore()
    first = RunCoordinator(store, CrashedExecutor(), require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
    await first.accept(request)
    with pytest.raises(asyncio.CancelledError):
        await first.execute(request)
    lost = await store.get(request.context.run_id)
    assert lost.status is AgentRunStatus.RUNNING and lost.usage is None
    second_executor = MagicMock(execute=AsyncMock())
    replacement = RunCoordinator(store, second_executor, require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
    assert (await store.create(request)).status is AgentRunStatus.RUNNING
    await replacement.execute(request)
    with pytest.raises(AgentRunStateError):
        await replacement.accept_resume(request.context.run_id, ResumeAgentRunRequest(
            interruption_id=uuid4(), idempotency_key="crash-recovery-not-allowed",
            answers=[ResumeAnswer(question_index=0, answer="retry")]))
    assert fake.responses.create.await_count == 1
    second_executor.execute.assert_not_awaited()
    await replacement.cancel(request.context.run_id)
    assert (await store.create(request)).status is AgentRunStatus.CANCELLED
    await replacement.execute(request)
    second_executor.execute.assert_not_awaited()


@pytest.mark.parametrize("status", [AgentRunStatus.RUNNING, AgentRunStatus.WAITING_FOR_USER,
                                    AgentRunStatus.CANCELLED, AgentRunStatus.COMPLETED])
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
    from retrieval.openai_service import _GeminiEmbedder, _GeminiSummarizer, _OpenAIEmbedder, _OpenAISummarizer

    fake = MagicMock()
    with platform_budget_scope(PlatformSpendLedger(budget())):
        for adapter in (_OpenAIEmbedder, _GeminiEmbedder):
            with pytest.raises(PlatformBudgetError, match="PLATFORM_RAPTOR_EMBEDDING_UNPRICED"):
                await adapter(fake, "unpriced").embed(["offline"])
        for adapter in (_OpenAISummarizer, _GeminiSummarizer):
            with pytest.raises(PlatformBudgetError, match="PLATFORM_RAPTOR_SUMMARY_UNPRICED"):
                await adapter(fake, "unpriced").summarize(["offline"])
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
            # A different coordinator cannot cancel this local task. Admission
            # remains under the original cap, which the backend never refunds.
            await budgeted_openai_attempt(fake, selection(), "after-remote-cancel", payload())
            return ExecutionOutcome(result=AgentRunResult(project_summary="bounded"))

    store = InMemoryAgentRunStore()
    running = RunCoordinator(store, Executor(), require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
    other_instance = RunCoordinator(store, MagicMock(), require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
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

    fake = SimpleNamespace(max_retries=0, responses=SimpleNamespace(create=AsyncMock(side_effect=lost_response)))
    with platform_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_EXPIRED"):
        await OpenAIModelProvider(fake).generate_structured(selection(), "text", max_output_tokens=100)
    assert fake.responses.create.await_count == 1
    assert ledger.cost == ledger.calls[0].reserved_cost_usd


async def test_unknown_byok_attempt_retains_token_bound_before_retry():
    credential_id = uuid4()
    ledger = PlatformSpendLedger(budget(), run_budget=incoming().budget.model_copy(update={"max_output_tokens": 100}))
    fake = client(TimeoutError(), response())
    with platform_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="OUTPUT_TOKEN_BUDGET_EXCEEDED"):
        await OpenAIModelProvider(fake, credential_id=credential_id).generate_structured(
            selection(credential_id=credential_id), "text", max_output_tokens=100)
    assert fake.responses.create.await_count == 1 and ledger.cost == 0
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
        # A restarted development service gets a completely empty store. Neither
        # the original request nor an outbox replay may reach the paid executor.
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
    await store.create(request)  # Simulates a legacy/replayed record bypassing accept.
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
    gateway = AIGateway(OpenAIModelProvider(fake), policy=GatewayPolicy(
        max_concurrency=1, circuit_failure_threshold=3, circuit_recovery_seconds=60))
    for _ in range(3):
        with platform_budget_scope(PlatformSpendLedger(budget("0.000001"))), pytest.raises(
                PlatformBudgetError, match="PLATFORM_BUDGET_EXCEEDED"):
            await gateway.generate_structured(selection(), "text", max_output_tokens=100)
        assert gateway.telemetry.snapshot().inflight_calls == 0
    fake.responses.create.assert_not_awaited()
    # A different user's valid reservation must reach the same platform provider.
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
    from runtime.runs import ExecutionEvent, publish_progress

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
                    selection(), "offline specialist", max_output_tokens=100)

            result = await delegate_internal_task(request.context.run_id, DepartmentName.REQUIREMENTS,
                                                  specialist, lambda generated: generated.payload["summary"])
            return ExecutionOutcome(result=AgentRunResult(project_summary=result.payload["summary"]))

    coordinator = RunCoordinator(store, Executor(), require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
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
