"""Production-guard BYOK tests. Every HTTP request is intercepted; no provider keys or network."""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from openai.types.responses import Response
from pydantic import ValidationError

from byok_budget import ByokExecutionLedger, byok_budget_scope, byok_openai_attempt, encode_payload
from contracts import (
    BYOK_COST_NOTICE_VERSION,
    AgentInput,
    AgentRunRequest,
    AgentRunResult,
    AgentRunStatus,
    AgentWorkflowMode,
    ByokBudget,
    ModelSelection,
    Provider,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from personal_credentials import credential_scope
from platform_budget import PlatformBudgetError, budgeted_openai_attempt, reject_unbounded_operation
from providers import CompositeModelProvider, GeminiModelProvider, OpenAIModelProvider
from runtime import ExecutionAuthorization, ExecutionOutcome, InMemoryAgentRunStore, RunCoordinator
from runtime.executor import OperationalAgentExecutor
from runtime.runs import merge_usage


def incoming(**budget_overrides):
    context = TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="byok-test", workspace_id=uuid4(),
                                project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run"])
    budget = RunBudget(**{**dict(max_duration_seconds=90, max_model_calls=6, max_tool_calls=5,
                               max_input_tokens=150000, max_output_tokens=6000,
                               max_departments=4, max_hierarchy_depth=2), **budget_overrides})
    selected = ModelSelection(provider=Provider.OPENAI, model="gpt-6.1-sol", credential_id=uuid4())
    scope = ByokBudget(scope_id=uuid4(), run_id=context.run_id, workspace_id=context.workspace_id,
                       project_id=context.project_id, initiated_by=context.initiated_by,
                       credential_id=selected.credential_id, provider=selected.provider, model=selected.model,
                       reasoning_effort=selected.reasoning_effort, funding_source="BYOK", service_tier="default",
                       cost_notice_version=BYOK_COST_NOTICE_VERSION,
                       valid_until=datetime.now(UTC) + timedelta(seconds=90),
                       max_model_calls=budget.max_model_calls, max_input_tokens=budget.max_input_tokens,
                       max_output_tokens=budget.max_output_tokens, budget=budget)
    return AgentRunRequest(context=context, budget=budget, model_selection=selected, byok_budget=scope,
                           safety_context=SafetyContextInput(),
                           input=AgentInput(requirement_text="Offline only", workflow_mode=AgentWorkflowMode.AD_HOC))


def shared_default_budget(*, personal=True):
    """Use the shared server contract; client-to-fixture matching belongs in frontend CI."""
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    fixtures = json.loads((root / "contracts/fixtures/workspace-credit-contract.json").read_text())
    values = fixtures["byokStart" if personal else "start"]["budget"]
    assert values == {
        "maxDurationSeconds": 180, "maxModelCalls": 50, "maxToolCalls": 12,
        "maxInputTokens": 150000 if personal else 50000, "maxOutputTokens": 48000,
        "maxDepartments": 4, "maxHierarchyDepth": 2, "maxSearchCredits": 2,
        "maxRetries": 2, "maxHandoffs": 3,
    }
    return RunBudget.model_validate(values)


def payload(request):
    return {"model": request.model_selection.model, "service_tier": "default", "reasoning": {"effort": "low"},
            "input": [{"role": "user", "content": "offline only"}], "tools": [], "store": False,
            "max_output_tokens": 100}


def provider_body(request, text=None, **overrides):
    result = dict(id="resp_offline", object="response", created_at=0, model=request.model_selection.model,
                  service_tier="default", status="completed", parallel_tool_calls=False, tool_choice="auto", tools=[],
                  usage={"input_tokens": 20, "output_tokens": 10, "total_tokens": 30,
                         "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
                         "output_tokens_details": {"reasoning_tokens": 0}},
                  output=[{"id": "msg_offline", "type": "message", "role": "assistant", "status": "completed",
                           "content": [{"type": "output_text", "annotations": [],
                                        "text": text or json.dumps({"summary": "offline", "open_questions": []})}]}])
    body = {**result, **overrides}
    Response.model_validate(body)
    return body


class OfflineHTTP:
    def __init__(self, request):
        self.request = request
        self.events = []
        self.attempts = []
        self.provider_requests = []
        self.provider_results = []
        self.admission_status = 200
        self.admission_override = {}
        self.credential_status = 200

    async def respond(self, request):
        if request.url.path.endswith("/attempts"):
            self.events.append("admission")
            body = json.loads(request.content)
            assert request.headers["X-Run-Id"] == str(self.request.context.run_id)
            assert request.headers["Authorization"] == "Bearer delegated-offline"
            assert body["credentialId"] == str(self.request.model_selection.credential_id)
            assert body["model"] == self.request.model_selection.model
            assert body["fundingSource"] == "BYOK" and body["serviceTier"] == "default"
            self.attempts.append(body)
            return httpx.Response(self.admission_status, json={"callId": body["callId"], "admitted": True,
                "validUntil": self.request.byok_budget.valid_until.isoformat(),
                "fundingSource": "BYOK", "serviceTier": "default", **self.admission_override})
        if request.url.path.endswith("/credential"):
            self.events.append("credential")
            assert request.headers["X-Run-Id"] == str(self.request.context.run_id)
            return httpx.Response(self.credential_status, json={"apiKey": "synthetic-personal-only"})
        assert str(request.url) == "https://api.openai.com/v1/responses"
        assert request.headers["Authorization"] == "Bearer synthetic-personal-only"
        assert "OpenAI-Organization" not in request.headers and "OpenAI-Project" not in request.headers
        self.events.append("provider")
        self.provider_requests.append(json.loads(request.content))
        if self.provider_results:
            result = self.provider_results.pop(0)
            if isinstance(result, Exception):
                raise result
            if isinstance(result, int):
                return httpx.Response(result, json={"error": "synthetic failure"})
            return httpx.Response(200, json=result)
        return httpx.Response(200, json=provider_body(self.request))

    def install(self, monkeypatch):
        original = httpx.AsyncClient
        def client(**kwargs):
            assert kwargs["follow_redirects"] is False and kwargs["trust_env"] is False
            return original(**kwargs, transport=httpx.MockTransport(self.respond))
        monkeypatch.setattr(httpx, "AsyncClient", client)


def scoped(request):
    ledger = ByokExecutionLedger(request, delegation_token="delegated-offline")
    ledger.persist_usage = AsyncMock()
    return ledger


async def call(request, *, max_attempts=2):
    platform = AsyncMock()
    with credential_scope("delegated-offline", request.context.run_id):
        result = await CompositeModelProvider(platform, platform).generate_structured(
            request.model_selection, "offline only", max_output_tokens=100, max_attempts=max_attempts)
    platform.generate_structured.assert_not_awaited()
    return result


async def test_true_byok_without_platform_budget_or_ambient_keys(monkeypatch):
    request = incoming()
    http = OfflineHTTP(request)
    http.install(monkeypatch)
    for name in ("OPENAI_API_KEY", "OPENAI_ADMIN_KEY", "OPENAI_ORG_ID", "OPENAI_PROJECT_ID"):
        monkeypatch.setenv(name, "ambient-must-not-be-used")
    monkeypatch.setenv("OPENAI_CUSTOM_HEADERS", "Authorization: Bearer ambient-key\nOpenAI-Project: ambient")
    ledger = scoped(request)
    with byok_budget_scope(ledger):
        result = await call(request)
    assert result.payload["summary"] == "offline"
    assert http.events == ["admission", "credential", "provider"]
    assert ledger.closed and len(ledger.calls) == 1
    usage = ledger.report(None)
    assert usage.byok_scope_id == request.byok_budget.scope_id
    assert usage.platform_reservation_id is None and usage.platform_cost_usd == Decimal("0")
    assert usage.input_tokens > result.input_tokens and usage.output_tokens == 100
    assert not usage.provider_calls[0].usage_known
    ledger.persist_usage.assert_awaited_once()


@pytest.mark.parametrize("field,value", [("run_id", uuid4()), ("workspace_id", uuid4()),
    ("project_id", uuid4()), ("initiated_by", uuid4()), ("credential_id", uuid4()),
    ("provider", Provider.GEMINI), ("model", "other"), ("reasoning_effort", "HIGH"),
    ("funding_source", "PLATFORM"), ("service_tier", "priority"), ("max_model_calls", 99)])
def test_scope_bindings_fail_closed(field, value):
    request = incoming()
    request.byok_budget = request.byok_budget.model_copy(update={field: value})
    with pytest.raises(PlatformBudgetError):
        ByokExecutionLedger(request)


def test_scope_requires_aware_time_and_exact_full_budget():
    request = incoming()
    with pytest.raises(ValidationError):
        ByokBudget(**{**request.byok_budget.model_dump(), "valid_until": datetime.now()})
    request.budget = request.budget.model_copy(update={"max_search_credits": 1})
    with pytest.raises(PlatformBudgetError, match="BYOK_SCOPE_MISMATCH"):
        ByokExecutionLedger(request)


@pytest.mark.parametrize("overrides", [{"admitted": False}, {"callId": str(uuid4())},
    {"fundingSource": "PLATFORM"}, {"serviceTier": "priority"}, {"validUntil": "2100-01-01T00:00:00Z"}])
async def test_forged_or_mismatched_admission_response_never_resolves_key(monkeypatch, overrides):
    request = incoming()
    http = OfflineHTTP(request)
    http.admission_override = overrides
    http.install(monkeypatch)
    ledger = scoped(request)
    with byok_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="BYOK_ADMISSION_FAILED"):
        await call(request)
    assert http.events == ["admission"] and not ledger.calls and ledger.blocked


@pytest.mark.parametrize("status", [401, 403, 404, 409, 429, 500])
async def test_unknown_expired_closed_or_duplicate_scope_rejected_without_provider(monkeypatch, status):
    request = incoming()
    http = OfflineHTTP(request)
    http.admission_status = status
    http.install(monkeypatch)
    ledger = scoped(request)
    with byok_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="BYOK_ADMISSION_FAILED"):
        await call(request)
    assert http.events == ["admission"] and not ledger.calls


async def test_every_retry_is_precharged_and_freshly_resolves_personal_key(monkeypatch):
    request = incoming()
    http = OfflineHTTP(request)
    http.provider_results = [429, provider_body(request)]
    http.install(monkeypatch)
    ledger = scoped(request)
    with byok_budget_scope(ledger):
        result = await call(request)
    assert result.model_calls == 2
    assert http.events == ["admission", "credential", "provider"] * 2
    assert len({item["callId"] for item in http.attempts}) == 2
    assert len(ledger.calls) == 2 and all(not call.usage_known for call in ledger.calls)


async def test_schema_retry_retains_prior_conservative_reservation(monkeypatch):
    request = incoming()
    http = OfflineHTTP(request)
    http.provider_results = [provider_body(request, "invalid JSON"), provider_body(request)]
    http.install(monkeypatch)
    ledger = scoped(request)
    with byok_budget_scope(ledger):
        await call(request)
    assert len(ledger.calls) == 2
    assert ledger.report(None).output_tokens == 200


async def test_credential_revocation_never_falls_back_and_consumes_reservation(monkeypatch):
    request = incoming()
    http = OfflineHTTP(request)
    http.credential_status = 403
    http.install(monkeypatch)
    ledger = scoped(request)
    with byok_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="BYOK_CREDENTIAL_UNAVAILABLE"):
        await call(request)
    assert http.events == ["admission", "credential"] and len(ledger.calls) == 1


async def test_failed_local_persistence_prevents_key_or_provider_io(monkeypatch):
    request = incoming()
    http = OfflineHTTP(request)
    http.install(monkeypatch)
    ledger = scoped(request)
    ledger.persist_usage.side_effect = OSError("offline database error")
    with byok_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="BYOK_PERSISTENCE_FAILED"):
        await call(request)
    assert http.events == ["admission"] and ledger.blocked


async def test_conservative_counters_never_reset_across_resume_or_duplicate_reports(monkeypatch):
    request = incoming(max_model_calls=1)
    http = OfflineHTTP(request)
    http.install(monkeypatch)
    ledger = scoped(request)
    with byok_budget_scope(ledger):
        await call(request)
    prior = merge_usage(ledger.report(None), ledger.report(None))
    assert prior.model_calls == 1 and prior.input_tokens == ledger.calls[0].input_tokens
    resumed = ByokExecutionLedger(request, prior, "delegated-offline")
    resumed.persist_usage = AsyncMock()
    with byok_budget_scope(resumed), pytest.raises(PlatformBudgetError, match="MODEL_CALL_BUDGET_EXCEEDED"):
        await call(request)
    assert len(http.provider_requests) == 1


@pytest.mark.parametrize("operation", ["EMBEDDING", "RAPTOR", "WEB_RESEARCH", "A2A", "GEMINI", "PETS",
                                       "ASSUMPTIONS", "DEEP_AGENT"])
def test_unbounded_paid_operations_stay_closed(operation):
    with byok_budget_scope(scoped(incoming())), pytest.raises(PlatformBudgetError, match="BYOK_.*_UNSUPPORTED"):
        reject_unbounded_operation(operation)


async def test_ambient_and_direct_supplied_clients_cannot_use_byok_scope():
    request = incoming()
    fake = SimpleNamespace(responses=SimpleNamespace(create=AsyncMock()))
    with byok_budget_scope(scoped(request)):
        with pytest.raises(PlatformBudgetError, match="BYOK_AMBIENT_CLIENT_FORBIDDEN"):
            await OpenAIModelProvider(fake, credential_id=request.model_selection.credential_id).generate_structured(
                request.model_selection, "offline", max_output_tokens=100)
        with pytest.raises(PlatformBudgetError, match="BYOK_AMBIENT_CLIENT_FORBIDDEN"):
            await budgeted_openai_attempt(fake, request.model_selection, "department_work_product", payload(request),
                                         client_credential_id=request.model_selection.credential_id)
        with pytest.raises(PlatformBudgetError, match="BYOK_SCOPE_MISMATCH"):
            await OpenAIModelProvider(fake).generate_structured(
                request.model_selection.model_copy(update={"credential_id": None}), "offline", max_output_tokens=100)
        with pytest.raises(PlatformBudgetError, match="BYOK_GEMINI_UNSUPPORTED"):
            await GeminiModelProvider(fake).generate_structured(
                request.model_selection, "offline", max_output_tokens=100)
    fake.responses.create.assert_not_awaited()


@pytest.mark.parametrize("operation", ["pet_profile", "quotation_assumption", "router", "embedding"])
async def test_other_generation_entrypoints_cannot_borrow_scope(operation):
    request = incoming()
    with byok_budget_scope(scoped(request)), pytest.raises(PlatformBudgetError, match="BYOK_OPERATION_UNSUPPORTED"):
        await byok_openai_attempt(request.model_selection, operation, payload(request))


async def test_ad_hoc_run_routes_locally_and_persists_closed_scope(monkeypatch):
    request = incoming()
    http = OfflineHTTP(request)
    http.install(monkeypatch)
    router = AsyncMock()
    platform = AsyncMock()
    executor = OperationalAgentExecutor(router, CompositeModelProvider(platform, platform))
    store = InMemoryAgentRunStore()
    coordinator = RunCoordinator(store, executor, require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
    await coordinator.accept(request)
    await coordinator.execute(request, ExecutionAuthorization("delegated-offline"))
    final = await store.get(request.context.run_id)
    assert final.status is AgentRunStatus.COMPLETED
    assert final.usage.model_calls == 1 and final.usage.execution_closed
    assert final.usage.byok_scope_id == request.byok_budget.scope_id
    router.route.assert_not_awaited()
    platform.generate_structured.assert_not_awaited()
    assert http.events == ["admission", "credential", "provider"]


async def test_production_rejects_memory_storage_and_legacy_personal_run():
    request = incoming()
    coordinator = RunCoordinator(InMemoryAgentRunStore(), AsyncMock(), require_platform_budget=True)
    with pytest.raises(PlatformBudgetError, match="DURABLE_STORE_REQUIRED"):
        await coordinator.accept(request)
    request.byok_budget = None
    with pytest.raises(PlatformBudgetError, match="BYOK_BUDGET_REQUIRED"):
        await coordinator.accept(request)


async def test_closed_scope_rejects_inherited_detached_task(monkeypatch):
    request = incoming()
    http = OfflineHTTP(request)
    http.install(monkeypatch)
    ready = asyncio.Event()
    async def late():
        await ready.wait()
        await call(request)
    with byok_budget_scope(scoped(request)):
        task = asyncio.create_task(late())
    ready.set()
    with pytest.raises(PlatformBudgetError, match="BYOK_SCOPE_CLOSED"):
        await task
    assert not http.events


async def test_queue_cancellation_closes_without_provider(monkeypatch):
    request = incoming()
    http = OfflineHTTP(request)
    http.install(monkeypatch)
    executor = AsyncMock()
    coordinator = RunCoordinator(InMemoryAgentRunStore(), executor, require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
    await coordinator.accept(request)
    await coordinator.cancel(request.context.run_id)
    await coordinator.execute(request, ExecutionAuthorization("delegated-offline"))
    final = await coordinator.view(request.context.run_id)
    assert final.status is AgentRunStatus.CANCELLED and final.usage.execution_closed
    assert final.usage.byok_scope_id == request.byok_budget.scope_id
    executor.execute.assert_not_awaited()
    assert not http.events


async def test_durable_attempt_exists_before_provider_network(monkeypatch):
    request = incoming()
    http = OfflineHTTP(request)
    http.install(monkeypatch)
    store = InMemoryAgentRunStore()
    original = http.respond
    async def observe(outgoing):
        if outgoing.url.host == "api.openai.com":
            snapshot = await store.get(request.context.run_id)
            assert snapshot.usage.model_calls == 1
            assert snapshot.usage.provider_calls[0].call_id == __import__("uuid").UUID(http.attempts[0]["callId"])
        return await original(outgoing)
    http.respond = observe
    class Executor:
        async def execute(self, *args):
            await call(request)
            return ExecutionOutcome(result=AgentRunResult(project_summary="offline"))
    coordinator = RunCoordinator(store, Executor(), require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
    await coordinator.accept(request)
    await coordinator.execute(request, ExecutionAuthorization("delegated-offline"))
    assert (await coordinator.view(request.context.run_id)).status is AgentRunStatus.COMPLETED


async def test_keyword_only_retrieval_never_invokes_embedder(monkeypatch):
    from contracts import ProjectContext
    from retrieval.knowledge_context import KnowledgeContextLoader

    request = incoming()
    request.context.effective_permissions += ["project.read", "document.read"]
    tools = AsyncMock()
    tools.get_project_context.return_value = ProjectContext(
        project_id=request.context.project_id, workspace_id=request.context.workspace_id, title="offline",
        requirement_text="offline", currency="KRW")
    tools.search_knowledge.return_value = []
    embedder = AsyncMock()
    loader = KnowledgeContextLoader(tools, embedder, "ambient-embedding-forbidden")
    with byok_budget_scope(scoped(request)):
        context = await loader.load(request, ExecutionAuthorization("delegated-offline"))
    assert context.retrieval_mode == "keyword_only"
    embedder.embed.assert_not_awaited()
    search = tools.search_knowledge.call_args.kwargs["request"]
    assert search.embedding is None and search.embedding_model is None


async def test_safety_route_remains_local_and_has_no_paid_io(monkeypatch):
    request = incoming()
    request.safety_context = SafetyContextInput(approval_required=True)
    http = OfflineHTTP(request)
    http.install(monkeypatch)
    router = AsyncMock()
    provider = AsyncMock()
    coordinator = RunCoordinator(InMemoryAgentRunStore(), OperationalAgentExecutor(router, provider),
                                 require_platform_budget=True, allow_memory_platform_budget_for_tests=True)
    await coordinator.accept(request)
    await coordinator.execute(request, ExecutionAuthorization("delegated-offline"))
    final = await coordinator.view(request.context.run_id)
    assert final.status is AgentRunStatus.WAITING_FOR_USER and final.usage.model_calls == 0
    router.route.assert_not_awaited()
    provider.generate_structured.assert_not_awaited()
    assert not http.events


def test_project_output_share_uses_plan_not_fifty_call_ceiling():
    request = incoming(max_model_calls=50, max_output_tokens=48000)
    request.input.workflow_mode = AgentWorkflowMode.PROJECT_ANALYSIS
    ledger = scoped(request)
    assert ledger.output_limit(48000) == 6000


async def test_local_router_does_not_construct_ambient_client_at_startup(monkeypatch):
    import hashlib

    import openai
    from pydantic import SecretStr

    from config import Settings
    from routing.wiring import build_openai_route_evaluator

    constructor = AsyncMock(side_effect=AssertionError("ambient client forbidden"))
    monkeypatch.setattr(openai, "AsyncOpenAI", constructor)
    secret = "synthetic routing policy"
    settings = Settings(route_evaluator_system_prompt=SecretStr(secret), route_evaluator_prompt_version="test",
                        route_evaluator_prompt_sha256=hashlib.sha256(secret.encode()).hexdigest())
    evaluator = build_openai_route_evaluator(settings)
    constructor.assert_not_called()
    with byok_budget_scope(scoped(incoming())), pytest.raises(PlatformBudgetError, match="BYOK_SCOPE_MISMATCH"):
        await evaluator.evaluate("offline", None)
    constructor.assert_not_called()


@pytest.mark.parametrize("mutation", [{"tools": [{"type": "web_search"}]}, {"service_tier": "priority"},
    {"model": "other"}, {"store": True}, {"reasoning": {"effort": "high"}}, {"background": True},
    {"input": [{"role": "user", "content": [{"type": "input_image", "image_url": "https://invalid"}]}]}])
async def test_unbounded_provider_payload_rejected_before_admission(mutation):
    request = incoming()
    ledger = scoped(request)
    with byok_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="BYOK_INPUT_UNBOUNDED"):
        await byok_openai_attempt(request.model_selection, "department_work_product", {**payload(request), **mutation})
    assert not ledger.calls
    ledger.persist_usage.assert_not_awaited()


async def test_small_input_budget_rejects_before_http(monkeypatch):
    request = incoming(max_input_tokens=1)
    http = OfflineHTTP(request)
    http.install(monkeypatch)
    with byok_budget_scope(scoped(request)), pytest.raises(PlatformBudgetError, match="INPUT_TOKEN_BUDGET_EXCEEDED"):
        await call(request)
    assert not http.events


@pytest.mark.parametrize("workflow,legacy", [(AgentWorkflowMode.AD_HOC, False),
    (AgentWorkflowMode.PROJECT_ANALYSIS, False), (AgentWorkflowMode.PROJECT_ANALYSIS, True)])
async def test_shared_defaults_complete_without_upgrading_legacy_scopes(monkeypatch, workflow, legacy):
    from contracts import ProjectContext
    from retrieval.knowledge_context import KnowledgeContextLoader

    limits = shared_default_budget().model_dump()
    assert shared_default_budget(personal=False).max_input_tokens == 50000
    if legacy:
        limits["max_input_tokens"] = 50000
    request = incoming(**limits)
    request.input.workflow_mode = workflow
    request.context.effective_permissions += ["project.read", "document.read"]
    http = OfflineHTTP(request)
    if workflow is AgentWorkflowMode.PROJECT_ANALYSIS:
        final = json.dumps({"action": "FINAL", "summary": "offline project department",
                            "open_questions": [], "quotation_drafts": []})
        http.provider_results = [provider_body(request, final)] * 4
    http.install(monkeypatch)
    tools = AsyncMock()
    tools.get_project_context.return_value = ProjectContext(
        project_id=request.context.project_id, workspace_id=request.context.workspace_id, title="offline",
        requirement_text="offline", currency="KRW")
    tools.search_knowledge.return_value = []
    embedder = AsyncMock()
    research = AsyncMock()
    shadow = AsyncMock()
    router = AsyncMock()
    platform = AsyncMock()
    executor = OperationalAgentExecutor(router, CompositeModelProvider(platform, platform), tools, research, shadow,
        KnowledgeContextLoader(tools, embedder, "ambient-embedding-forbidden"))
    coordinator = RunCoordinator(InMemoryAgentRunStore(), executor, require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
    await coordinator.accept(request)
    await coordinator.execute(request, ExecutionAuthorization("delegated-offline"))
    final = await coordinator.view(request.context.run_id)
    if legacy:
        assert final.status is AgentRunStatus.FAILED
        assert final.error_code == "BYOK_PLAN_INPUT_BUDGET_EXCEEDED"
        assert final.usage.model_calls == 0 and final.usage.execution_closed
        assert not http.events
        router.route.assert_not_awaited()
        embedder.embed.assert_not_awaited()
        research.collect.assert_not_awaited()
        shadow.register.assert_not_awaited()
        return
    assert final.status is AgentRunStatus.COMPLETED
    expected = 4 if workflow is AgentWorkflowMode.PROJECT_ANALYSIS else 1
    assert final.usage.model_calls == expected and len(http.provider_requests) == expected
    assert final.usage.input_tokens <= request.budget.max_input_tokens and final.usage.output_tokens <= 48000
    assert final.usage.execution_closed and final.usage.platform_cost_usd == 0
    if workflow is AgentWorkflowMode.PROJECT_ANALYSIS:
        assert len(final.result.department_results) == 4
    for outgoing in http.provider_requests:
        assert outgoing["model"] == request.model_selection.model
        assert outgoing["tools"] == []
        assert "web_research" not in json.dumps(outgoing)
    router.route.assert_not_awaited()
    embedder.embed.assert_not_awaited()
    research.collect.assert_not_awaited()
    shadow.register.assert_not_awaited()
    platform.generate_structured.assert_not_awaited()
    platform.generate_react_step.assert_not_awaited()


def test_schema_annotation_compaction_preserves_property_names_literals_and_validation():
    from jsonschema import Draft202012Validator

    from providers import _compact_json_schema

    schema = {
        "title": "Annotation", "description": "Annotation", "type": "object", "additionalProperties": False,
        "properties": {
            "title": {"type": "string", "minLength": 2, "maxLength": 8, "title": "Only annotation"},
            "description": {"$ref": "#/$defs/description"},
            "default": {"const": {"title": "keep", "description": "keep", "default": 4}},
            "examples": {"enum": [{"title": "keep", "description": "also keep"}]},
        },
        "required": ["title", "description", "default", "examples"],
        "$defs": {"description": {"type": "integer", "minimum": 1, "maximum": 5, "default": 2,
                                    "description": "Only annotation"}},
    }
    compact = _compact_json_schema(schema)
    assert set(compact["properties"]) == set(schema["properties"])
    assert compact["required"] == schema["required"]
    assert compact["properties"]["default"] == schema["properties"]["default"]
    assert compact["properties"]["examples"] == schema["properties"]["examples"]
    assert compact["properties"]["description"]["$ref"] == schema["properties"]["description"]["$ref"]
    assert "title" not in compact and "description" not in compact
    original = Draft202012Validator(schema)
    reduced = Draft202012Validator(compact)
    valid = {"title": "valid", "description": 2, "default": {"title": "keep", "description": "keep", "default": 4},
             "examples": {"title": "keep", "description": "also keep"}}
    samples = [valid, {}, {**valid, "title": "a"}, {**valid, "title": "very long value"},
               {**valid, "description": 0}, {**valid, "default": {}}, {**valid, "surplus": 1}]
    for sample in samples:
        assert original.is_valid(sample) == reduced.is_valid(sample)
    assert original.is_valid(valid)
    assert len(json.dumps(compact).encode()) < len(json.dumps(schema).encode())


def test_prompt_compaction_keeps_safety_domain_preferences_and_unicode_exact():
    from providers import ReActStep, _byok_prompt_and_schema

    envelope = {"operation": "bounded_react_step", "objective": {
        "department": "RESEARCH", "untrusted_user_request": "한글 🌈 quoted: \\\"\\n",
        "pet_preference_rules": "preserve all safety instructions", "untrusted_pet_preferences": [],
        "builtin_skills": {"selected_ids": [], "workflows": []},
        "grounded_memory_rules": ["preserve source text"], "constraints": {"no_price_or_tax_invention": True}},
        "observations": [], "previous_step_feedback": None}
    original = ReActStep.model_json_schema()
    prompt, compact = _byok_prompt_and_schema(json.dumps(envelope), original)
    assert json.loads(prompt) == envelope
    assert compact["properties"].keys() == original["properties"].keys()
    assert compact["required"] == original["required"]


async def test_unicode_escaping_admission_matches_exact_transmitted_bytes(monkeypatch):
    request = incoming()
    http = OfflineHTTP(request)
    http.install(monkeypatch)
    ledger = scoped(request)
    body = payload(request)
    body["input"][0]["content"] = "한글 🌈\\n\\\"/ Unicode"
    with byok_budget_scope(ledger), credential_scope("delegated-offline", request.context.run_id):
        await byok_openai_attempt(request.model_selection, "department_work_product", body)
    assert http.attempts[0]["inputTokens"] == len(encode_payload(http.provider_requests[0])) + 8192


REALISTIC_KOREAN_REQUIREMENT = (
    "지역 소상공인을 위한 반응형 예약 웹사이트를 만들고 싶습니다. 고객은 날짜와 시간을 선택하고 예약 내용을 "
    "수정하거나 취소할 수 있어야 합니다. 관리자는 영업시간, 휴무일, 서비스 가격과 예약 현황을 관리합니다. "
    "초기에는 온라인 결제를 넣지 않고 현장 결제만 지원합니다. 모바일 접근성과 개인정보 최소 수집을 우선하고, "
    "6주 안에 시범 운영할 수 있도록 필수 기능과 후속 기능을 나눠 주세요. 현재 자료에 근거해 화면 목록, "
    "개발 범위, 검수 기준, 일정 위험과 세 가지 견적안을 정리해 주세요."
)
REALISTIC_PROJECT_SOURCE = (
    "확정된 요구사항: 초기 출시에는 회원가입 없이 이름, 연락처, 서비스와 예약 시간만 받습니다. "
    "문자 발송 서비스 계약은 아직 없으므로 자동 알림은 후속 단계로 표시해야 합니다. 운영자는 한 명이며 "
    "노트북과 휴대전화에서 예약을 확인합니다. 외부 결제, 자동 환불, 쿠폰, 다국어는 이번 계약 범위에 포함하지 "
    "않습니다. 고객 제공 이미지와 로고를 사용하고 기존 도메인을 연결합니다. 접근 권한과 개인정보 보관 "
    "기간은 작업 시작 전 고객의 확인이 필요합니다."
)
REALISTIC_REFERENCE = (
    "기존 업무 메모: 매장 영업시간은 화요일부터 일요일 오전 10시부터 오후 7시까지입니다. 서비스별 "
    "소요시간이 다르므로 예약 간격은 관리자가 설정할 수 있어야 합니다. 동시 예약은 한 건만 처리합니다. "
    "변경·취소 마감은 전날 오후 6시라는 운영 규칙을 화면에 안내합니다. 담당자가 확정하기 전에는 "
    "이 규칙을 계약상 의무나 법적 판단으로 단정하지 않습니다."
)


def three_quotation_drafts():
    return [
        {"scenario": scenario, "items": [{
            "title": title, "description": description, "quantity": hours, "unit": "HOUR", "rateCardHint": None,
            "basis": {"type": "ASSUMPTION", "content": "고객 확인과 상세 검수 기준 합의를 전제로 한 추정",
                      "sourceReference": None, "sourceTitle": None}}],
         "petPerspective": {"proposal": title, "rationale": "제공된 프로젝트 범위에 근거한 단계적 제안",
                            "tradeoff": "추가 기능은 고객 승인 후 별도 범위로 합의"}}
        for scenario, title, description, hours in (
            ("LEAN", "핵심 예약 화면", "예약 등록과 기본 관리자 확인", 40),
            ("RECOMMENDED", "예약 변경·취소와 관리자", "기본 예약과 변경·취소, 영업시간 관리", 72),
            ("EXPANDED", "확장 검수와 운영 가이드", "권장 범위와 접근성 검수 및 운영 문서", 96),
        )
    ]


def react_reply(*, quotations=False, tool=False):
    return {"action": "TOOL" if tool else "FINAL", "tool_name": "get_project_context" if tool else None,
            "arguments": {"query": None}, "summary": None if tool else "제공된 자료에 근거한 단계별 분석",
            "open_questions": [], "quotation_drafts": three_quotation_drafts() if quotations else []}


def realistic_tools(request):
    from contracts import KnowledgeSearchResult, MemorySourceMessage, ProjectContext, SkillSelection

    request.context.effective_permissions = ["agent.run", "project.read", "document.read"]
    request.input.requirement_text = REALISTIC_KOREAN_REQUIREMENT
    request.input.workflow_mode = AgentWorkflowMode.PROJECT_ANALYSIS
    request.input.skill_selection = SkillSelection(mode="MANUAL", manual_ids=[
        "writing-proposal", "dev-requirements-acceptance", "ops-milestone-plan"])
    tools = AsyncMock()
    source = MemorySourceMessage(id=uuid4(), event_order=1, kind="PROJECT_INPUT", content=REALISTIC_PROJECT_SOURCE,
                                 created_at=datetime.now(UTC))
    tools.get_project_context.return_value = ProjectContext(project_id=request.context.project_id,
        workspace_id=request.context.workspace_id, title="예약 웹사이트",
        requirement_text=request.input.requirement_text,
        currency="KRW", source_messages=[source])
    tools.search_knowledge.return_value = [KnowledgeSearchResult(chunk_id=uuid4(), document_id=uuid4(),
        document_title="확정 운영 메모", source_type="PROJECT", content=REALISTIC_REFERENCE,
        confirmation_status="confirmed", project_id=request.context.project_id, origin="user", memory_type="reference",
        rrf_score=.1, keyword_rank=1)]
    return tools


async def run_realistic_project(monkeypatch, *, needs_tools=False, oversized=False, integrity_fault=False):
    from retrieval.knowledge_context import KnowledgeContextLoader

    request = incoming(**shared_default_budget().model_dump())
    request.byok_budget = request.byok_budget.model_copy(update={
        "valid_until": datetime.now(UTC) + timedelta(seconds=request.budget.max_duration_seconds)})
    tools = realistic_tools(request)
    if oversized:
        request.input.requirement_text += " 추가 확인이 필요한 상세 요구사항입니다." * 300
    http = OfflineHTTP(request)
    replies = []
    for index in range(4):
        if needs_tools:
            replies.append(react_reply(tool=True))
        replies.append(react_reply(quotations=index in {0, 2}))
    http.provider_results = [provider_body(request, json.dumps(reply, ensure_ascii=False)) for reply in replies]
    if integrity_fault:
        http.provider_results[1] = provider_body(request, json.dumps(replies[1]), model="unexpected-provider-model")
    http.install(monkeypatch)
    embedder, router, platform, research, shadow = [AsyncMock() for _ in range(5)]
    executor = OperationalAgentExecutor(router, CompositeModelProvider(platform, platform), tools, research, shadow,
        KnowledgeContextLoader(tools, embedder, "ambient-embedding-forbidden"))
    coordinator = RunCoordinator(InMemoryAgentRunStore(), executor, require_platform_budget=True,
                                 allow_memory_platform_budget_for_tests=True)
    await coordinator.accept(request)
    await coordinator.execute(request, ExecutionAuthorization("delegated-offline"))
    final = await coordinator.view(request.context.run_id)
    for dependency, method in ((router, "route"), (embedder, "embed"), (research, "collect"),
                               (shadow, "register"), (platform, "generate_react_step")):
        getattr(dependency, method).assert_not_awaited()
    assert final.usage.byok_scope_id == request.byok_budget.scope_id and final.usage.execution_closed
    assert final.usage.platform_cost_usd == 0 and final.usage.platform_reservation_id is None
    assert final.usage.model_calls == len(http.provider_requests) == len(http.attempts)
    assert final.usage.input_tokens == sum(attempt["inputTokens"] for attempt in http.attempts) <= 150000
    assert final.usage.output_tokens == sum(attempt["maxOutputTokens"] for attempt in http.attempts) <= 48000
    assert all(attempt["fundingSource"] == "BYOK" and attempt["serviceTier"] == "default"
               for attempt in http.attempts)
    assert all(attempt["maxOutputTokens"] == 4000 for attempt in http.attempts)
    return request, final, http, replies


async def test_approved_150k_realistic_three_skill_four_stage_quote_completes(monkeypatch):
    from jsonschema import Draft202012Validator

    request, final, http, replies = await run_realistic_project(monkeypatch)
    assert final.status is AgentRunStatus.COMPLETED
    assert final.usage.model_calls == 4 and 95000 < final.usage.input_tokens < 110000
    assert len(final.result.department_results) == 4
    assert all(department.status == "COMPLETED" for department in final.result.department_results)
    assert [draft.scenario for draft in final.result.quotation_drafts] == ["LEAN", "RECOMMENDED", "EXPANDED"]
    assert [draft.items[0].quantity for draft in final.result.quotation_drafts] == [40, 72, 96]
    for body, reply in zip(http.provider_requests, replies, strict=True):
        Draft202012Validator(body["text"]["format"]["schema"]).validate(reply)
        assert body["model"] == request.model_selection.model and body["service_tier"] == "default"
        assert body["tools"] == [] and body["store"] is False
        assert "web_research" not in json.dumps(body)
        assert all(skill in body["input"][1]["content"] for skill in request.input.skill_selection.manual_ids)
        assert REALISTIC_KOREAN_REQUIREMENT in body["input"][1]["content"]
    assert http.events == ["admission", "credential", "provider"] * 4


async def test_approved_150k_oversized_plan_stops_before_admission_key_or_provider(monkeypatch):
    _, final, http, _ = await run_realistic_project(monkeypatch, oversized=True)
    assert final.status is AgentRunStatus.FAILED
    assert final.error_code == "BYOK_PLAN_INPUT_BUDGET_EXCEEDED"
    assert final.usage.model_calls == 0 and not http.events


async def test_approved_150k_extra_tool_steps_stop_without_scope_refill(monkeypatch):
    _, final, http, _ = await run_realistic_project(monkeypatch, needs_tools=True)
    assert final.status is AgentRunStatus.PARTIAL
    assert final.result is not None
    completed = [result for result in final.result.department_results if result.status == "COMPLETED"]
    unfinished = [result for result in final.result.department_results if result.status in {"FAILED", "SKIPPED"}]
    assert completed and unfinished and len(completed) + len(unfinished) == 4
    assert sum(result.status == "FAILED" for result in unfinished) == 1
    assert all(result.summary == "제공된 자료에 근거한 단계별 분석" for result in completed)
    assert all(result.summary != "제공된 자료에 근거한 단계별 분석" for result in unfinished)
    assert final.result.quotation_drafts == []  # Incomplete deal-design work cannot publish a full quote.
    assert final.error_code == "INPUT_TOKEN_BUDGET_EXCEEDED"
    assert 4 <= final.usage.model_calls < 8
    assert all(not call.usage_known for call in final.usage.provider_calls)
    assert http.events == ["admission", "credential", "provider"] * final.usage.model_calls


async def test_approved_150k_response_integrity_fault_stays_fatal_after_completed_department(monkeypatch):
    _, final, http, _ = await run_realistic_project(monkeypatch, integrity_fault=True)
    assert final.status is AgentRunStatus.FAILED
    assert final.error_code == "BYOK_RESPONSE_BINDING_MISMATCH"
    assert final.result is None and final.usage.model_calls == 2
    assert http.events == ["admission", "credential", "provider"] * 2


def test_supported_cost_notice_marker_roundtrips_in_exact_scope_without_authority_change():
    request = incoming()
    original = request.byok_budget
    wire = original.model_dump(mode="json", by_alias=True)
    assert wire["costNoticeVersion"] == BYOK_COST_NOTICE_VERSION
    restored = ByokBudget.model_validate(wire)
    assert restored == original
    assert restored.scope_id == original.scope_id and restored.budget == original.budget
    assert restored.valid_until == original.valid_until
    with pytest.raises(ValidationError):
        ByokBudget.model_validate({**wire, "costNoticeVersion": "unknown-or-future-version"})


@pytest.mark.parametrize("absent", [True, False])
async def test_legacy_null_or_absent_notice_retains_original_limits_deadline_and_admission(monkeypatch, absent):
    request = incoming(max_input_tokens=50000)
    wire = request.byok_budget.model_dump(mode="json", by_alias=True)
    if absent:
        wire.pop("costNoticeVersion")
    else:
        wire["costNoticeVersion"] = None
    legacy = ByokBudget.model_validate(wire)
    request.byok_budget = legacy
    assert legacy.cost_notice_version is None and legacy.max_input_tokens == 50000
    http = OfflineHTTP(request)
    http.admission_status = 409  # Missing/closed backend scope cannot be granted by a null marker.
    http.install(monkeypatch)
    ledger = scoped(request)
    with byok_budget_scope(ledger), pytest.raises(PlatformBudgetError, match="BYOK_ADMISSION_FAILED"):
        await call(request)
    assert http.events == ["admission"] and not ledger.calls
    assert request.byok_budget == legacy
    assert request.byok_budget.valid_until == datetime.fromisoformat(wire["validUntil"].replace("Z", "+00:00"))
    assert request.byok_budget.budget.max_input_tokens == 50000


async def test_unknown_notice_marker_is_rejected_before_backend_or_provider_io(monkeypatch):
    request = incoming()
    http = OfflineHTTP(request)
    http.install(monkeypatch)
    request.byok_budget = request.byok_budget.model_copy(update={"cost_notice_version": "unknown-version"})
    with pytest.raises(PlatformBudgetError, match="BYOK_COST_NOTICE_VERSION_UNSUPPORTED"):
        scoped(request)
    assert not http.events
