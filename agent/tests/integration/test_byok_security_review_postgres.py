"""Independent durable BYOK resume test. Real PostgreSQL, in-memory HTTP only."""

# ruff: noqa: E501
from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest
from openai.types.responses import Response

import byok_budget
from byok_budget import byok_openai_attempt
from contracts import (
    AgentInput,
    AgentInterruption,
    AgentRunRequest,
    AgentRunStatus,
    ByokBudget,
    InterruptionKind,
    ModelSelection,
    Provider,
    ResumeAgentRunRequest,
    ResumeAnswer,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from infrastructure.database import PgVectorConnectionManager, PgVectorPoolConfig
from infrastructure.database.models import AgentRunStateModel
from personal_credentials import credential_scope
from platform_budget import PlatformBudgetError, offline_provider_test_scope
from runtime import ExecutionAuthorization, ExecutionOutcome, PostgresAgentRunStore, RunCoordinator

DATABASE_URL = os.getenv("AGENT_INTEGRATION_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="AGENT_INTEGRATION_DATABASE_URL is not configured")


def request_fixture():
    context = TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="byok-durable-review",
        workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run", "project.read"])
    budget = RunBudget(max_duration_seconds=180, max_model_calls=1, max_tool_calls=3,
        max_input_tokens=50000, max_output_tokens=100, max_departments=1, max_hierarchy_depth=1)
    selection = ModelSelection(provider=Provider.OPENAI, model="gpt-6-luna", credential_id=uuid4())
    scope = ByokBudget(scope_id=uuid4(), run_id=context.run_id, workspace_id=context.workspace_id,
        project_id=context.project_id, initiated_by=context.initiated_by, credential_id=selection.credential_id,
        provider=selection.provider, model=selection.model, reasoning_effort=selection.reasoning_effort,
        funding_source="BYOK", service_tier="default", valid_until=datetime.now(UTC) + timedelta(seconds=180),
        max_model_calls=1, max_input_tokens=50000, max_output_tokens=100, budget=budget)
    return AgentRunRequest(context=context, budget=budget, model_selection=selection, byok_budget=scope,
        safety_context=SafetyContextInput(), input=AgentInput(requirement_text="Synthetic review", workflow_mode="AD_HOC"))


async def test_byok_attempt_survives_real_postgres_restart_and_expired_resume_preserves_pause(monkeypatch):
    assert DATABASE_URL is not None
    request = request_fixture()
    events = []
    provider_response = {"id": "resp_synthetic", "object": "response", "created_at": 0,
        "model": request.model_selection.model, "service_tier": "default", "status": "completed",
        "parallel_tool_calls": False, "tool_choice": "none", "tools": [], "output": [],
        "usage": {"input_tokens": 10, "output_tokens": 1, "total_tokens": 11,
                  "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0}, "output_tokens_details": {"reasoning_tokens": 0}}}
    Response.model_validate(provider_response)

    async def respond(outgoing):
        if outgoing.url.path.endswith("/attempts"):
            events.append("admission")
            body = json.loads(outgoing.content)
            return httpx.Response(200, json={"callId": body["callId"], "admitted": True,
                "validUntil": request.byok_budget.valid_until.isoformat(), "fundingSource": "BYOK", "serviceTier": "default"})
        if outgoing.url.path.endswith("/credential"):
            events.append("credential")
            return httpx.Response(200, json={"apiKey": "synthetic-personal-key"})
        assert str(outgoing.url) == "https://api.openai.com/v1/responses"
        assert outgoing.headers["Authorization"] == "Bearer synthetic-personal-key"
        events.append("provider")
        return httpx.Response(200, json=provider_response)

    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: real_client(
        **kwargs, transport=httpx.MockTransport(respond)))

    class Executor:
        async def execute(self, request, resume=None, authorization=None):
            assert authorization is not None
            with credential_scope(authorization.delegation_token, request.context.run_id):
                await byok_openai_attempt(request.model_selection, "department_work_product", {
                    "model": request.model_selection.model, "service_tier": "default", "reasoning": {"effort": "low"},
                    "input": [{"role": "user", "content": "Synthetic data"}], "tools": [], "store": False,
                    "max_output_tokens": 100})
            return ExecutionOutcome(interruption=AgentInterruption(interruption_id=uuid4(),
                kind=InterruptionKind.CLARIFICATION, questions=["Synthetic clarification?"]))

    auth = ExecutionAuthorization("synthetic-delegation")
    first = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
    with offline_provider_test_scope(False):
        await first.open()
        await first.create_runtime_tables()
        try:
            coordinator = RunCoordinator(PostgresAgentRunStore(first), Executor(), require_platform_budget=True)
            accepted = await coordinator.accept(request)
            # Emulate pre-notice durable JSON. The original scope is not renewed
            # and explicit null in a modern retry must compare identically.
            async with first.session() as session:
                row = await session.get(AgentRunStateModel, request.context.run_id)
                legacy_request = dict(row.request_json)
                legacy_scope = dict(legacy_request["byok_budget"])
                legacy_scope.pop("cost_notice_version", None)
                legacy_request["byok_budget"] = legacy_scope
                row.request_json = legacy_request
            replay = await coordinator.accept(request)
            assert replay.run_id == accepted.run_id
            assert (await PostgresAgentRunStore(first).get_request(request.context.run_id)).byok_budget == request.byok_budget
            await coordinator.execute(request, auth)
            waiting = await coordinator.view(request.context.run_id)
            assert waiting.status is AgentRunStatus.WAITING_FOR_USER
            assert waiting.usage.model_calls == 1 and waiting.usage.execution_closed
            assert waiting.usage.byok_scope_id == request.byok_budget.scope_id
            assert waiting.usage.platform_reservation_id is None
            assert events == ["admission", "credential", "provider"]
            command = ResumeAgentRunRequest(interruption_id=waiting.interruption.interruption_id,
                idempotency_key="synthetic-restart", answers=[ResumeAnswer(question_index=0, answer="Synthetic answer")])
        finally:
            await first.close()

        second = PgVectorConnectionManager(PgVectorPoolConfig(database_url=DATABASE_URL))
        await second.open()
        try:
            coordinator = RunCoordinator(PostgresAgentRunStore(second), Executor(), require_platform_budget=True)
            # An expired resume must not consume the interruption or erase prior work.
            with patch.object(byok_budget, "datetime", wraps=datetime) as clock:
                clock.now.return_value = request.byok_budget.valid_until + timedelta(seconds=1)
                with pytest.raises(PlatformBudgetError, match="BYOK_BUDGET_EXPIRED"):
                    await coordinator.accept_resume(request.context.run_id, command)
            still_waiting = await coordinator.view(request.context.run_id)
            assert still_waiting.status is AgentRunStatus.WAITING_FOR_USER
            assert still_waiting.interruption == waiting.interruption and still_waiting.usage == waiting.usage
            _, resumed = await coordinator.accept_resume(request.context.run_id, command)
            assert resumed.byok_budget == request.byok_budget
            await coordinator.resume(resumed, command, auth)
            final = await coordinator.view(request.context.run_id)
            assert final.status is AgentRunStatus.FAILED
            assert final.error_code == "MODEL_CALL_BUDGET_EXCEEDED"
            assert final.usage.model_calls == 1 and final.usage.provider_calls == waiting.usage.provider_calls
            assert final.usage.byok_scope_id == request.byok_budget.scope_id
            assert events == ["admission", "credential", "provider"]
            async with second.session() as session:
                row = await session.get(AgentRunStateModel, request.context.run_id)
                saved = json.dumps({"request": row.request_json, "usage": row.usage_json})
                assert "synthetic-personal-key" not in saved and "synthetic-delegation" not in saved
        finally:
            await second.close()
