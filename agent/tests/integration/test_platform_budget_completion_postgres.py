"""Real PostgreSQL completion-scope restart and authenticated resume. Provider I/O is mocked."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI

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
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from infrastructure.database.models import AgentRunStateModel
from platform_budget import TARIFF_VERSION, budgeted_openai_attempt, completion_reserve, offline_provider_test_scope
from runtime import ExecutionAuthorization, ExecutionOutcome, PostgresAgentRunStore, RunCoordinator
from security import DelegationTokenVerifier

DATABASE_URL = os.getenv("AGENT_INTEGRATION_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="AGENT_INTEGRATION_DATABASE_URL is not configured")


def request_fixture(completion, calls):
    run_id = uuid4()
    budget = RunBudget(max_duration_seconds=19, max_model_calls=calls, max_tool_calls=3,
                       max_input_tokens=28013, max_output_tokens=307, max_departments=1, max_hierarchy_depth=1)
    scope = PlatformBudget(reservation_id=run_id, max_cost_usd=Decimal("1"), tariff_version=TARIFF_VERSION,
        valid_until=datetime(2031, 1, 31, 14, 59, tzinfo=UTC),
        completion=PlatformCompletionEnvelope(protocol_version="completion-v1", policy_revision=11,
                                             allowed_models=["gpt-6-luna"], budget=budget.model_copy(deep=True)))
    scope.max_cost_usd = completion_reserve(scope)
    if not completion:
        scope.completion = None
    return AgentRunRequest(context=TrustedRunContext(run_id=run_id, thread_id=uuid4(),
        trace_id="synthetic-durable-completion", workspace_id=uuid4(), project_id=uuid4(),
        initiated_by=uuid4(), effective_permissions=["agent.run"]), budget=budget, platform_budget=scope,
        model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-6-luna"),
        safety_context=SafetyContextInput(), input=AgentInput(requirement_text="Synthetic durable completion"))


@pytest.mark.parametrize("completion,calls", [(False, 2), (True, 1), (True, 2)])
async def test_authenticated_month_boundary_resume_preserves_postgres_ledger(completion, calls):
    assert DATABASE_URL is not None
    request = request_fixture(completion, calls)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = key.public_key().public_bytes(serialization.Encoding.PEM,
                                          serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    verifier = DelegationTokenVerifier(public_key=public, issuer="synthetic-backend", audience="synthetic-agent")
    now = datetime.now(UTC)
    context = request.context
    deadline = int((now + timedelta(seconds=request.budget.max_duration_seconds)).timestamp())
    claims = {"iss": "synthetic-backend", "aud": "synthetic-agent", "sub": str(context.initiated_by),
        "jti": str(uuid4()), "iat": now - timedelta(minutes=2), "exp": deadline,
        "execution_deadline": deadline,
        "run_id": str(context.run_id), "workspace_id": str(context.workspace_id),
        "project_id": str(context.project_id), "initiated_by": str(context.initiated_by),
        "permissions": ["agent.run", "agent.respond"]}
    fresh_token = jwt.encode(claims, key, algorithm="RS256")
    expired_token = jwt.encode({**claims, "exp": now - timedelta(seconds=30)}, key, algorithm="RS256")
    control_token = jwt.encode({name: value for name, value in claims.items()
                               if name != "execution_deadline"}, key, algorithm="RS256")
    store = None
    observed_attempt_counts = []

    async def provider(**kwargs):
        current = await store.get(context.run_id)
        observed_attempt_counts.append(current.usage.model_calls)
        assert not current.usage.provider_calls[-1].usage_known
        if len(observed_attempt_counts) == 2:
            return SimpleNamespace(model="gpt-6-luna", service_tier="default", usage=None)
        return SimpleNamespace(model="gpt-6-luna", service_tier="default",
            usage=SimpleNamespace(input_tokens=61, output_tokens=11,
                input_tokens_details=SimpleNamespace(cached_tokens=0, cache_write_tokens=0)))

    fake = SimpleNamespace(base_url="https://api.openai.com/v1", max_retries=0,
                           responses=SimpleNamespace(create=AsyncMock(side_effect=provider)))

    class Executor:
        async def execute(self, request, resume=None, authorization=None):
            assert authorization is not None
            verifier.verify(authorization.delegation_token)
            await budgeted_openai_attempt(fake, request.model_selection, "synthetic", {
                "model": "gpt-6-luna", "service_tier": "default", "tools": [], "store": False,
                "input": [{"role": "user", "content": "Synthetic"}], "max_output_tokens": 107})
            if resume is None:
                return ExecutionOutcome(interruption=AgentInterruption(interruption_id=uuid4(),
                    kind=InterruptionKind.CLARIFICATION, questions=["Synthetic clarification?"]))
            return ExecutionOutcome(result=AgentRunResult(project_summary="Synthetic complete"))

    with offline_provider_test_scope(False), patch.object(platform_budget, "datetime", wraps=datetime) as clock:
        clock.now.return_value = datetime(2031, 1, 31, 14, 58, tzinfo=UTC)
        first = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
        await first.open()
        await first.create_runtime_tables()
        try:
            store = PostgresAgentRunStore(first)
            owner = RunCoordinator(store, Executor(), require_platform_budget=True)
            await owner.accept(request)
            # Missing legacy completion parses identically to null on idempotent replay.
            if not completion:
                async with first.session() as session:
                    row = await session.get(AgentRunStateModel, context.run_id)
                    saved = dict(row.request_json)
                    scope = dict(saved["platform_budget"])
                    scope.pop("completion", None)
                    saved["platform_budget"] = scope
                    row.request_json = saved
                await owner.accept(request)
            await owner.execute(request, ExecutionAuthorization(fresh_token))
            waiting = await owner.view(context.run_id)
            assert waiting.status is AgentRunStatus.WAITING_FOR_USER
            assert waiting.usage.model_calls == 1 and waiting.usage.execution_closed
            assert waiting.usage.platform_cost_usd > 0
            command = {"interruptionId": str(waiting.interruption.interruption_id),
                       "idempotencyKey": "synthetic-restart", "answers": [{"questionIndex": 0, "answer": "Synthetic"}]}
        finally:
            await first.close()

        # New engine, session pool, store, coordinator and HTTP app simulate process restart.
        clock.now.return_value = datetime(2031, 2, 1, 15, 1, tzinfo=UTC)
        second = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
        await second.open()
        try:
            store = PostgresAgentRunStore(second)
            owner = RunCoordinator(store, Executor(), require_platform_budget=True)
            restored = await store.get_request(context.run_id)
            assert restored.platform_budget == request.platform_budget and restored.budget == request.budget
            assert (await owner.view(context.run_id)).usage == waiting.usage
            app = FastAPI()
            app.include_router(router)
            app.state.run_coordinator = owner
            app.state.delegation_token_verifier = verifier

            @app.middleware("http")
            async def tracing(request, call_next):
                request.state.traceparent = None
                return await call_next(request)

            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://synthetic") as http:
                path = f"/internal/v1/agent-runs/{context.run_id}/resume"
                denied = await http.post(path, headers={"Authorization": f"Bearer {expired_token}"}, json=command)
                assert denied.status_code == 401 and denied.json()["code"] == "DELEGATION_TOKEN_INVALID"
                assert (await owner.view(context.run_id)).interruption == waiting.interruption
                control = await http.post(path, headers={"Authorization": f"Bearer {control_token}"}, json=command)
                assert control.status_code == 403 and control.json()["code"] == "EXECUTION_AUTHORITY_REQUIRED"
                assert (await owner.view(context.run_id)).usage == waiting.usage
                resumed = await http.post(path, headers={"Authorization": f"Bearer {fresh_token}"}, json=command)
                if not completion:
                    assert resumed.status_code == 409 and resumed.json()["code"] == "PLATFORM_BUDGET_EXPIRED"
                    unchanged = await owner.view(context.run_id)
                    assert unchanged.status is AgentRunStatus.WAITING_FOR_USER
                    assert unchanged.interruption == waiting.interruption and unchanged.usage == waiting.usage
                else:
                    assert resumed.status_code == 202
                    final = await owner.view(context.run_id)
                    assert final.usage.execution_closed
                    assert final.usage.provider_calls[0] == waiting.usage.provider_calls[0]
                    assert final.usage.platform_reservation_id == context.run_id
                    assert final.usage.tariff_version == request.platform_budget.tariff_version
                    if calls == 1:
                        assert final.status is AgentRunStatus.FAILED
                        assert final.error_code == "MODEL_CALL_BUDGET_EXCEEDED"
                        assert final.usage.model_calls == 1
                        assert final.usage.platform_cost_usd == waiting.usage.platform_cost_usd
                    else:
                        assert final.status is AgentRunStatus.COMPLETED and final.usage.model_calls == 2
                        unknown = final.usage.provider_calls[1]
                        assert not unknown.usage_known and unknown.cost_usd == unknown.reserved_cost_usd
                        assert final.usage.platform_cost_usd == waiting.usage.platform_cost_usd + unknown.cost_usd
                        assert final.usage.input_tokens == waiting.usage.input_tokens + unknown.input_tokens
                        assert final.usage.output_tokens == waiting.usage.output_tokens + unknown.output_tokens
                        assert final.usage.platform_cost_usd <= request.platform_budget.max_cost_usd
                    assert (await store.get_request(context.run_id)).platform_budget == request.platform_budget
            assert observed_attempt_counts == ([1, 2] if completion and calls == 2 else [1])
            async with second.session() as session:
                row = await session.get(AgentRunStateModel, context.run_id)
                persisted = json.dumps({"request": row.request_json, "usage": row.usage_json})
                assert all(token not in persisted for token in (fresh_token, expired_token, control_token))
        finally:
            await second.close()
