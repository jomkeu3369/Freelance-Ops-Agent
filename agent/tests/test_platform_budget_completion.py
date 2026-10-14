"""Synthetic completion-v1 bounds; no live models, credentials or operational policy amounts."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

import platform_budget
from api.agent_runs.router import router
from contracts import (
    AgentInput,
    AgentInterruption,
    AgentRunRequest,
    AgentRunResult,
    AgentRunStatus,
    InterruptionKind,
    ModelSelection,
    PlatformBudget,
    PlatformCompletionEnvelope,
    Provider,
    ResumeAgentRunRequest,
    ResumeAnswer,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from platform_budget import (
    TARIFF_VERSION,
    PlatformBudgetError,
    PlatformSpendLedger,
    Tariff,
    budgeted_openai_attempt,
    completion_reserve,
    platform_budget_scope,
    validate_platform_request,
)
from providers import OpenAIModelProvider
from runtime import ExecutionOutcome, InMemoryAgentRunStore, RunCoordinator
from runtime.runs import merge_usage
from security import DelegationTokenVerifier


def completion_request(*, models=None, calls=4):
    run_id = uuid4()
    run_budget = RunBudget(max_duration_seconds=17, max_model_calls=calls, max_tool_calls=3,
                           max_input_tokens=36017, max_output_tokens=503, max_departments=1,
                           max_hierarchy_depth=1, max_retries=1, max_handoffs=2)
    scope = PlatformBudget(
        reservation_id=run_id, max_cost_usd=Decimal("1"), tariff_version=TARIFF_VERSION,
        valid_until=datetime(2031, 1, 31, 14, 59, tzinfo=UTC),
        completion=PlatformCompletionEnvelope(protocol_version="completion-v1", policy_revision=7,
            allowed_models=models or ["gpt-6-luna", "gpt-5.6-luna"], budget=run_budget.model_copy(deep=True)))
    scope.max_cost_usd = completion_reserve(scope)
    return AgentRunRequest(context=TrustedRunContext(run_id=run_id, thread_id=uuid4(),
        trace_id="synthetic-completion", workspace_id=uuid4(), project_id=uuid4(),
        initiated_by=uuid4(), effective_permissions=["agent.run"]), budget=run_budget,
        platform_budget=scope, model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-6-luna"),
        safety_context=SafetyContextInput(), input=AgentInput(requirement_text="Synthetic completion test"))


def body(model="gpt-6-luna"):
    return {"model": model, "service_tier": "default", "input": [{"role": "user", "content": "Synthetic"}],
            "tools": [], "store": False, "max_output_tokens": 103}


def result(**overrides):
    values = {"model": "gpt-6-luna", "service_tier": "default",
        "output_text": json.dumps({"summary": "Synthetic", "open_questions": []}),
        "usage": SimpleNamespace(input_tokens=71, output_tokens=13,
            input_tokens_details=SimpleNamespace(cached_tokens=0, cache_write_tokens=0))}
    values.update(overrides)
    return SimpleNamespace(**values)


def client(*responses):
    return SimpleNamespace(base_url="https://api.openai.com/v1", max_retries=0,
                           responses=SimpleNamespace(create=AsyncMock(side_effect=list(responses))))


def ledger_for(request, previous=None):
    return PlatformSpendLedger(request.platform_budget, previous, request.budget)


def coordinator(store, executor):
    return RunCoordinator(store, executor, require_platform_budget=True, allow_memory_platform_budget_for_tests=True)


def command_for(view):
    return ResumeAgentRunRequest(interruption_id=view.interruption.interruption_id,
        idempotency_key=str(uuid4()), answers=[ResumeAnswer(question_index=0, answer="Synthetic answer")])


def interruption():
    return AgentInterruption(interruption_id=uuid4(), kind=InterruptionKind.CLARIFICATION,
                             questions=["Synthetic clarification?"])


def test_completion_wire_and_legacy_omission_and_null_round_trip():
    request = completion_request()
    wire = request.model_dump(mode="json", by_alias=True)
    assert wire["platformBudget"]["completion"]["protocolVersion"] == "completion-v1"
    assert wire["platformBudget"]["completion"]["policyRevision"] == 7
    assert wire["platformBudget"]["completion"]["budget"] == wire["budget"]
    assert AgentRunRequest.model_validate(wire) == request
    wire["platformBudget"].pop("completion")
    legacy = AgentRunRequest.model_validate(wire)
    assert legacy.platform_budget.completion is None
    wire["platformBudget"]["completion"] = None
    assert AgentRunRequest.model_validate(wire) == legacy
    legacy_wire = legacy.model_dump(mode="json", by_alias=True)
    assert "completion" not in legacy_wire["platformBudget"]
    legacy_persisted = legacy.model_dump(mode="json")
    assert "completion" not in legacy_persisted["platform_budget"]

    # Baseline Agent's extra-forbid schema can still read pre-rollout persistence.
    from pydantic import create_model

    from contracts import StrictModel

    baseline = create_model("BaselinePlatformBudget", __base__=StrictModel,
        reservation_id=(UUID, ...), max_cost_usd=(Decimal, ...), tariff_version=(str, ...),
        valid_until=(datetime, ...))
    assert baseline.model_validate(legacy_persisted["platform_budget"]).reservation_id == legacy.context.run_id
    with pytest.raises(ValidationError):
        baseline.model_validate(request.platform_budget.model_dump(mode="json"))


@pytest.mark.parametrize("field,value", [
    ("protocolVersion", "completion-v2"), ("policyRevision", 0), ("allowedModels", []),
    ("allowedModels", ["gpt-6-luna", "gpt-6-luna"]), ("allowedModels", [""]), ("extra", True),
])
def test_completion_schema_fails_closed(field, value):
    wire = completion_request().platform_budget.completion.model_dump(mode="json", by_alias=True)
    wire[field] = value
    with pytest.raises(ValidationError):
        PlatformCompletionEnvelope.model_validate(wire)


@pytest.mark.parametrize("field", list(RunBudget.model_fields))
async def test_every_run_budget_field_is_bound_before_admission(field):
    request = completion_request()
    request.budget = request.budget.model_copy(update={field: getattr(request.budget, field) + 1})
    store = InMemoryAgentRunStore()
    with pytest.raises(PlatformBudgetError, match="PLATFORM_COMPLETION_BUDGET_MISMATCH"):
        await coordinator(store, MagicMock()).accept(request)
    assert not store._records


def test_aggregate_reserve_uses_each_models_worst_cached_rate_and_rounding_margin(monkeypatch):
    tariffs = platform_budget.TARIFF_VERSIONS[TARIFF_VERSION]
    monkeypatch.setitem(tariffs, (Provider.OPENAI, "gpt-6-luna"),
                        Tariff(Decimal(".13"), Decimal(".71"), Decimal(".27"), Decimal(".11")))
    monkeypatch.setitem(tariffs, (Provider.OPENAI, "gpt-5.6-luna"),
                        Tariff(Decimal(".17"), Decimal(".19"), Decimal(".23"), Decimal(".83")))
    request = completion_request()
    # Input .71 and output .83 come from different approved models.
    assert completion_reserve(request.platform_budget) == Decimal(".02598959")
    ledger_for(request).validate()
    request.platform_budget.max_cost_usd -= Decimal(".00000001")
    with pytest.raises(PlatformBudgetError, match="PLATFORM_COMPLETION_RESERVE_INSUFFICIENT"):
        ledger_for(request).validate()


@pytest.mark.parametrize("calls", [0, 1, 4])
def test_rounding_margin_never_becomes_negative(calls):
    request = completion_request(calls=calls)
    expected = Decimal(".00960785") + Decimal(max(0, calls - 1)) * Decimal(".00000001")
    assert completion_reserve(request.platform_budget) == expected


@pytest.mark.parametrize("models", [["gpt-6-luna-snapshot"], [" gpt-6-luna"], ["Gpt-6-luna"], ["gemini"]])
def test_exact_unpriced_model_ids_are_rejected(models):
    request = completion_request()
    request.platform_budget.completion.allowed_models = models
    with pytest.raises(PlatformBudgetError, match="PLATFORM_MODEL_UNPRICED"):
        validate_platform_request(request)


def test_unknown_tariff_and_expired_promotional_price_still_fail():
    request = completion_request()
    request.platform_budget.tariff_version = "unknown-synthetic-tariff"
    with pytest.raises(PlatformBudgetError, match="PLATFORM_TARIFF_UNSUPPORTED"):
        validate_platform_request(request)
    request.platform_budget.tariff_version = TARIFF_VERSION
    request.platform_budget.completion.allowed_models.append("gpt-5.6-sol")
    with patch.object(platform_budget, "datetime", wraps=datetime) as clock:
        clock.now.return_value = platform_budget.PROMOTION_REVIEW_AT
        with pytest.raises(PlatformBudgetError, match="PLATFORM_TARIFF_REVIEW_REQUIRED"):
            validate_platform_request(request)


@pytest.mark.parametrize("provider,model", [(Provider.OPENAI, "gpt-6-sol"), (Provider.GEMINI, "gpt-6-luna")])
async def test_initial_selection_and_every_attempt_must_be_allowlisted(provider, model):
    request = completion_request()
    forbidden = ModelSelection(provider=provider, model=model)
    changed = request.model_copy(update={"model_selection": forbidden})
    with pytest.raises(PlatformBudgetError, match="PLATFORM_COMPLETION_MODEL_FORBIDDEN"):
        await coordinator(InMemoryAgentRunStore(), MagicMock()).accept(changed)
    fake = client(result())
    with platform_budget_scope(ledger_for(request)), pytest.raises(
            PlatformBudgetError, match="PLATFORM_COMPLETION_MODEL_FORBIDDEN"):
        await budgeted_openai_attempt(fake, forbidden, "synthetic", body(model))
    fake.responses.create.assert_not_awaited()


@pytest.mark.parametrize("limit,code", [("max_model_calls", "MODEL_CALL"),
                                        ("max_input_tokens", "INPUT_TOKEN"),
                                        ("max_output_tokens", "OUTPUT_TOKEN")])
async def test_completion_keeps_existing_aggregate_limits(limit, code):
    request = completion_request()
    request.budget = request.budget.model_copy(update={limit: 0})
    request.platform_budget.completion.budget = request.budget.model_copy(deep=True)
    fake = client(result())
    with platform_budget_scope(ledger_for(request)), pytest.raises(
            PlatformBudgetError, match=f"{code}_BUDGET_EXCEEDED"):
        await budgeted_openai_attempt(fake, request.model_selection, "synthetic", body())
    fake.responses.create.assert_not_awaited()


async def test_retry_unknown_and_invalid_json_attempts_are_cumulative_under_completion():
    request = completion_request()
    ledger = ledger_for(request)
    fake = client(TimeoutError(), result(output_text="invalid JSON"), result())
    with platform_budget_scope(ledger):
        await OpenAIModelProvider(fake, max_attempts=3).generate_structured(
            request.model_selection, "Synthetic", max_output_tokens=103)
    assert len(ledger.calls) == len({call.call_id for call in ledger.calls}) == 3
    assert not ledger.calls[0].usage_known
    assert ledger.calls[0].cost_usd == ledger.calls[0].reserved_cost_usd
    assert ledger.previous_cost + ledger.cost <= request.platform_budget.max_cost_usd
    resumed = ledger_for(request, ledger.report(None))
    with platform_budget_scope(resumed):
        await budgeted_openai_attempt(client(result()), request.model_selection, "resumed", body())
        with pytest.raises(PlatformBudgetError, match="MODEL_CALL_BUDGET_EXCEEDED"):
            await budgeted_openai_attempt(fake, request.model_selection, "too-many", body())
    merged = merge_usage(ledger.report(None), resumed.report(None))
    assert merged.model_calls == 4
    assert merged.platform_cost_usd == ledger.cost + resumed.cost
    assert fake.responses.create.await_count == 3


@pytest.mark.parametrize("bad_response,code", [(result(model="gpt-6-sol"), "MODEL_MISMATCH"),
                                               (result(service_tier="priority"), "TIER_MISMATCH")])
async def test_completion_response_mismatch_blocks_resume(bad_response, code):
    request = completion_request()
    ledger = ledger_for(request)
    with platform_budget_scope(ledger), pytest.raises(PlatformBudgetError, match=f"PLATFORM_RESPONSE_{code}"):
        await budgeted_openai_attempt(client(bad_response), request.model_selection, "synthetic", body())
    assert ledger.unpriced_exposure
    resumed = ledger_for(request, ledger.report(None))
    with platform_budget_scope(resumed), pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_EXCEEDED"):
        await budgeted_openai_attempt(client(result()), request.model_selection, "resumed", body())
    assert not resumed.calls


async def test_completion_sdk_retries_and_tier_guards_are_not_relaxed():
    request = completion_request()
    fake = client(result())
    fake.max_retries = 2
    with platform_budget_scope(ledger_for(request)), pytest.raises(
            PlatformBudgetError, match="PLATFORM_SDK_RETRIES_UNBOUNDED"):
        await budgeted_openai_attempt(fake, request.model_selection, "synthetic", body())
    fake.max_retries = 0
    with platform_budget_scope(ledger_for(request)), pytest.raises(
            PlatformBudgetError, match="PLATFORM_SERVICE_TIER_UNPRICED"):
        await budgeted_openai_attempt(fake, request.model_selection, "synthetic",
                                      {**body(), "service_tier": "priority"})
    fake.responses.create.assert_not_awaited()


async def test_completion_cancel_retains_unknown_attempt_and_money():
    request = completion_request()
    entered = asyncio.Event()

    async def pending(**kwargs):
        entered.set()
        await asyncio.Future()

    fake = client()
    fake.responses.create.side_effect = pending

    class Executor:
        async def execute(self, *args):
            await budgeted_openai_attempt(fake, request.model_selection, "synthetic", body())

    store = InMemoryAgentRunStore()
    owner = coordinator(store, Executor())
    await owner.accept(request)
    task = asyncio.create_task(owner.execute(request))
    await entered.wait()
    await owner.cancel(request.context.run_id)
    with pytest.raises(asyncio.CancelledError):
        await task
    final = await owner.view(request.context.run_id)
    assert final.status is AgentRunStatus.CANCELLED
    assert final.usage.model_calls == 1 and final.usage.execution_closed
    assert final.usage.platform_cost_usd == final.usage.provider_calls[0].reserved_cost_usd
    assert not final.usage.provider_calls[0].usage_known


@pytest.mark.parametrize("completion", [False, True])
async def test_month_boundary_resume_preserves_scope_counters_and_prior_spend(completion):
    request = completion_request(calls=1)
    if not completion:
        request.platform_budget.completion = None
    fake = client(result())

    class Executor:
        async def execute(self, request, *args):
            await budgeted_openai_attempt(fake, request.model_selection, "synthetic", body())
            return ExecutionOutcome(interruption=interruption())

    store = InMemoryAgentRunStore()
    owner = coordinator(store, Executor())
    with patch.object(platform_budget, "datetime", wraps=datetime) as clock:
        clock.now.return_value = datetime(2031, 1, 31, 14, 58, tzinfo=UTC)
        await owner.accept(request)
        await owner.execute(request)
        waiting = await owner.view(request.context.run_id)
        command = command_for(waiting)
        clock.now.return_value = datetime(2031, 2, 1, 14, 59, tzinfo=UTC)
        if not completion:
            with pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_EXPIRED"):
                await owner.accept_resume(request.context.run_id, command)
            unchanged = await owner.view(request.context.run_id)
            assert unchanged.status is AgentRunStatus.WAITING_FOR_USER
            assert unchanged.interruption == waiting.interruption and unchanged.usage == waiting.usage
        else:
            _, resumed = await owner.accept_resume(request.context.run_id, command)
            assert resumed.platform_budget == request.platform_budget and resumed.budget == request.budget
            await owner.resume(resumed, command)
            final = await owner.view(request.context.run_id)
            assert final.status is AgentRunStatus.FAILED and final.error_code == "MODEL_CALL_BUDGET_EXCEEDED"
            assert final.usage.provider_calls == waiting.usage.provider_calls
            assert final.usage.platform_cost_usd == waiting.usage.platform_cost_usd
    assert fake.responses.create.await_count == 1


def test_past_monetary_expiry_never_authorizes_expired_jwt_but_fresh_jwt_can_resume():
    request = completion_request()
    request.platform_budget.valid_until = datetime(2020, 1, 31, tzinfo=UTC)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = key.public_key().public_bytes(serialization.Encoding.PEM,
                                          serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    verifier = DelegationTokenVerifier(public_key=public, issuer="synthetic-backend", audience="synthetic-agent")
    context = request.context
    now = datetime.now(UTC)
    deadline = int((now + timedelta(seconds=request.budget.max_duration_seconds)).timestamp())
    claims = {"iss": "synthetic-backend", "aud": "synthetic-agent", "sub": str(context.initiated_by),
        "jti": str(uuid4()), "iat": now - timedelta(minutes=2), "exp": deadline,
        "execution_deadline": deadline,
        "run_id": str(context.run_id), "workspace_id": str(context.workspace_id),
        "project_id": str(context.project_id), "initiated_by": str(context.initiated_by),
        "permissions": ["agent.run", "agent.respond"]}
    valid = jwt.encode(claims, key, algorithm="RS256")
    expired = jwt.encode({**claims, "exp": now - timedelta(seconds=30)}, key, algorithm="RS256")
    control = jwt.encode({name: value for name, value in claims.items()
                         if name != "execution_deadline"}, key, algorithm="RS256")

    class Executor:
        async def execute(self, request, resume=None, authorization=None):
            assert authorization is not None
            if resume is None:
                return ExecutionOutcome(interruption=interruption())
            return ExecutionOutcome(result=AgentRunResult(project_summary="Synthetic resumed"))

    app = FastAPI()
    app.include_router(router)
    app.state.run_coordinator = coordinator(InMemoryAgentRunStore(), Executor())
    app.state.delegation_token_verifier = verifier

    @app.middleware("http")
    async def tracing(request, call_next):
        request.state.traceparent = None
        return await call_next(request)

    with TestClient(app) as http:
        denied_start = http.post("/internal/v1/agent-runs", headers={"Authorization": f"Bearer {control}"},
                                 json=request.model_dump(mode="json", by_alias=True))
        assert denied_start.status_code == 403 and denied_start.json()["code"] == "EXECUTION_AUTHORITY_REQUIRED"
        start = http.post("/internal/v1/agent-runs", headers={"Authorization": f"Bearer {valid}"},
                          json=request.model_dump(mode="json", by_alias=True))
        assert start.status_code == 202
        path = f"/internal/v1/agent-runs/{context.run_id}"
        waiting = http.get(path, headers={"Authorization": f"Bearer {valid}"}).json()
        resume = {"interruptionId": waiting["interruption"]["interruptionId"], "idempotencyKey": "synthetic-auth",
                  "answers": [{"questionIndex": 0, "answer": "Synthetic"}]}
        assert http.post(path + "/resume", json=resume).status_code == 401
        denied = http.post(path + "/resume", headers={"Authorization": f"Bearer {expired}"}, json=resume)
        assert denied.status_code == 401 and denied.json()["code"] == "DELEGATION_TOKEN_INVALID"
        denied_control = http.post(path + "/resume", headers={"Authorization": f"Bearer {control}"}, json=resume)
        assert denied_control.status_code == 403 and denied_control.json()["code"] == "EXECUTION_AUTHORITY_REQUIRED"
        still_waiting = http.get(path, headers={"Authorization": f"Bearer {valid}"}).json()
        assert still_waiting["interruption"] == waiting["interruption"]
        assert http.post(path + "/resume", headers={"Authorization": f"Bearer {valid}"}, json=resume).status_code == 202
        assert http.get(path, headers={"Authorization": f"Bearer {valid}"}).json()["status"] == "COMPLETED"


async def test_configured_router_model_is_checked_before_durable_acceptance():
    request = completion_request(models=["gpt-6-luna"])
    store = InMemoryAgentRunStore()
    owner = RunCoordinator(store, MagicMock(), require_platform_budget=True,
        allow_memory_platform_budget_for_tests=True,
        platform_model_selections=(ModelSelection(provider=Provider.OPENAI, model="gpt-5.6-luna"),))
    with pytest.raises(PlatformBudgetError, match="PLATFORM_COMPLETION_MODEL_FORBIDDEN"):
        await owner.accept(request)
    assert not store._records


async def test_router_calls_also_enforce_completion_allowlist_before_provider_io():
    import hashlib

    from routing.llm_evaluator import OpenAIRouteEvaluator, SecretSystemPrompt

    request = completion_request(models=["gpt-6-luna"])
    fake = client(result())
    prompt = "Synthetic route policy"
    secret = SecretSystemPrompt(prompt, "synthetic", hashlib.sha256(prompt.encode()).hexdigest())
    router = OpenAIRouteEvaluator(fake, secret)
    with platform_budget_scope(ledger_for(request)), pytest.raises(
            PlatformBudgetError, match="PLATFORM_COMPLETION_MODEL_FORBIDDEN"):
        await router.evaluate("Synthetic", None)
    fake.responses.create.assert_not_awaited()


async def test_completion_runtime_timeout_is_still_enforced(monkeypatch):
    request = completion_request()

    class Executor:
        async def execute(self, *args):
            return ExecutionOutcome(result=AgentRunResult(project_summary="Unreachable"))

    async def timed_out(coroutine, *, timeout):
        assert timeout == request.budget.max_duration_seconds
        coroutine.close()
        raise TimeoutError()

    monkeypatch.setattr("runtime.runs.asyncio.wait_for", timed_out)
    owner = coordinator(InMemoryAgentRunStore(), Executor())
    await owner.accept(request)
    await owner.execute(request)
    final = await owner.view(request.context.run_id)
    assert final.status is AgentRunStatus.FAILED and final.error_code == "RUN_TIMEOUT"
    assert final.usage.execution_closed and final.usage.platform_cost_usd == 0


@pytest.mark.parametrize("limit,code", [("max_input_tokens", "INPUT_TOKEN"),
                                        ("max_output_tokens", "OUTPUT_TOKEN")])
async def test_completion_resume_cannot_reset_aggregate_tokens(limit, code):
    request = completion_request()
    bound = len(json.dumps(body(), ensure_ascii=False).encode("utf-8")) + 8192
    value = bound if limit == "max_input_tokens" else body()["max_output_tokens"]
    request.budget = request.budget.model_copy(update={limit: value})
    request.platform_budget.completion.budget = request.budget.model_copy(deep=True)
    request.platform_budget.max_cost_usd = completion_reserve(request.platform_budget)
    first = ledger_for(request)
    with platform_budget_scope(first):
        await budgeted_openai_attempt(client(result()), request.model_selection, "first", body())
    prior = first.report(None)
    resumed = ledger_for(request, prior)
    fake = client(result())
    with platform_budget_scope(resumed), pytest.raises(PlatformBudgetError, match=f"{code}_BUDGET_EXCEEDED"):
        await budgeted_openai_attempt(fake, request.model_selection, "resumed", body())
    fake.responses.create.assert_not_awaited()
    combined = merge_usage(prior, resumed.report(None))
    assert combined.provider_calls == prior.provider_calls
    assert combined.platform_cost_usd == prior.platform_cost_usd
    assert combined.input_tokens == prior.input_tokens and combined.output_tokens == prior.output_tokens


async def test_cancel_during_attempt_persistence_blocks_provider_io_without_refund():
    request = completion_request()
    ledger = ledger_for(request)
    fake = client(result())

    async def persist(usage):
        assert usage.model_calls == 1 and usage.platform_cost_usd > 0
        ledger.blocked = True

    ledger.persist_usage = persist
    with platform_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="PLATFORM_BUDGET_EXCEEDED"):
        await budgeted_openai_attempt(fake, request.model_selection, "synthetic", body())
    fake.responses.create.assert_not_awaited()
    assert len(ledger.calls) == 1 and ledger.cost == ledger.calls[0].reserved_cost_usd


async def test_underfunded_completion_fails_before_any_durable_acceptance():
    request = completion_request()
    request.platform_budget.max_cost_usd -= Decimal(".00000001")
    store = InMemoryAgentRunStore()
    with pytest.raises(PlatformBudgetError, match="PLATFORM_COMPLETION_RESERVE_INSUFFICIENT"):
        await coordinator(store, MagicMock()).accept(request)
    assert not store._records
