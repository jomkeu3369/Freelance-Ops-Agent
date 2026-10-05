"""Independent BYOK security regressions, using only synthetic in-memory transports.

These tests deliberately turn the permissive legacy provider test seam off.
They can also run with stdlib unittest in the lightweight review environment.
"""

# ruff: noqa: E501
from __future__ import annotations

import asyncio
import json
import os
import socket
import sys
import unittest
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta
from json import loads
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx

import byok_budget
from byok_budget import ByokExecutionLedger, byok_budget_scope, byok_openai_attempt
from contracts import (
    AgentInput,
    AgentRunRequest,
    ByokBudget,
    ModelSelection,
    Provider,
    ReasoningEffort,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from platform_budget import PlatformBudgetError, offline_provider_test_scope


def make_request() -> AgentRunRequest:
    context = TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="security-review",
        workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(),
        effective_permissions=["agent.run", "project.read", "document.read"])
    budget = RunBudget(max_duration_seconds=30, max_model_calls=4, max_tool_calls=3,
        max_input_tokens=100000, max_output_tokens=400, max_departments=1, max_hierarchy_depth=1)
    selection = ModelSelection(provider=Provider.OPENAI, model="gpt-6-luna",
        reasoning_effort=ReasoningEffort.LOW, credential_id=uuid4())
    scope = ByokBudget(scope_id=uuid4(), run_id=context.run_id, workspace_id=context.workspace_id,
        project_id=context.project_id, initiated_by=context.initiated_by,
        credential_id=selection.credential_id, provider=selection.provider, model=selection.model,
        reasoning_effort=selection.reasoning_effort, funding_source="BYOK", service_tier="default",
        valid_until=datetime.now(UTC) + timedelta(minutes=2), max_model_calls=budget.max_model_calls,
        max_input_tokens=budget.max_input_tokens, max_output_tokens=budget.max_output_tokens, budget=budget)
    return AgentRunRequest(context=context, budget=budget, model_selection=selection,
        safety_context=SafetyContextInput(), input=AgentInput(requirement_text="Synthetic review", workflow_mode="AD_HOC"),
        byok_budget=scope)


def payload(selection: ModelSelection, output: int = 100) -> dict:
    return {"model": selection.model, "service_tier": "default",
        "reasoning": {"effort": selection.reasoning_effort.value.lower()},
        "input": [{"role": "user", "content": "Synthetic data only"}],
        "tools": [], "store": False, "max_output_tokens": output}


class ByokSecurityReview(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(offline_provider_test_scope(False))
        # Any unmocked network path fails the test before a connection is opened.
        self.stack.enter_context(patch.object(socket.socket, "connect", side_effect=AssertionError("network forbidden")))
        self.stack.enter_context(patch.object(socket.socket, "connect_ex", side_effect=AssertionError("network forbidden")))
        self.request = make_request()
        self.ledger = ByokExecutionLedger(self.request, delegation_token="synthetic-delegation")
        self.persist = AsyncMock()
        self.ledger.persist_usage = self.persist
        self.admissions: list[dict] = []
        self.provider_requests: list[dict] = []
        self.provider_payloads: list[dict] = []
        self.http_settings: list[dict] = []
        self.before_admission = None
        self.before_provider = None
        self.before_client_enter = None
        self.admission_body = None
        self.resolve = AsyncMock(return_value="synthetic-personal-key")
        self.stack.enter_context(patch.object(byok_budget, "resolve_credential", self.resolve))
        settings = SimpleNamespace(backend_internal_url="http://backend.invalid", backend_tool_timeout_seconds=5,
                                  model_timeout_seconds=5)
        self.stack.enter_context(patch.object(byok_budget, "get_settings", return_value=settings))
        owner = self

        class FakeHTTP:
            def __init__(self, **kwargs):
                owner.http_settings.append(kwargs)
                self.provider = owner.resolve.await_count > len(owner.provider_payloads)

            async def __aenter__(self):
                if self.provider and owner.before_client_enter is not None:
                    await owner.before_client_enter()
                return self

            async def __aexit__(self, *_):
                return None

            async def post(self, url, *, headers, json=None, content=None):
                if content is not None:
                    json = loads(content)
                if url == "https://api.openai.com/v1/responses":
                    owner.provider_requests.append({"url": url, "headers": headers, "body": json, "content": content})
                    owner.provider_payloads.append(json)
                    if owner.before_provider is not None:
                        value = await owner.before_provider(json)
                        return httpx.Response(200, json={"model": value.model, "service_tier": value.service_tier,
                            "usage": vars(value.usage)})
                    return httpx.Response(200, json={"model": owner.request.model_selection.model,
                        "service_tier": "default", "usage": {"input_tokens": 10, "output_tokens": 1}})
                owner.admissions.append({"url": url, "headers": headers, "body": json})
                if owner.before_admission is not None:
                    await owner.before_admission()
                body = owner.admission_body or {"callId": json["callId"], "admitted": True,
                    "validUntil": owner.request.byok_budget.valid_until.isoformat(),
                    "fundingSource": "BYOK", "serviceTier": "default"}
                return httpx.Response(200, json=body)

        class FakeResponse:
            @staticmethod
            def model_validate(value):
                # Provider response schema itself is covered by adapter integration tests.
                return SimpleNamespace(**{**value, "usage": SimpleNamespace(**value["usage"])})

        self.stack.enter_context(patch.object(byok_budget.httpx, "AsyncClient", FakeHTTP))
        self.stack.enter_context(patch.dict(sys.modules, {
            "openai.types.responses": SimpleNamespace(Response=FakeResponse)}))

    async def invoke(self, value: dict | None = None, operation: str = "department_work_product"):
        return await byok_openai_attempt(self.request.model_selection, operation,
                                         payload(self.request.model_selection) if value is None else value)

    async def test_valid_call_reserves_and_persists_before_personal_provider(self):
        async def resolve(*_):
            self.assertEqual(len(self.admissions), 1)
            self.persist.assert_awaited_once()
            self.assertEqual(len(self.provider_payloads), 0)
            return "synthetic-personal-key"
        self.resolve.side_effect = resolve
        with byok_budget_scope(self.ledger):
            await self.invoke()
        self.assertEqual(len(self.provider_payloads), 1)
        self.assertEqual(self.provider_requests[0]["headers"]["Authorization"], "Bearer synthetic-personal-key")
        self.assertEqual(self.provider_requests[0]["url"], "https://api.openai.com/v1/responses")
        self.assertFalse(self.http_settings[-1]["trust_env"])
        call = self.ledger.calls[0]
        self.assertFalse(call.usage_known)
        self.assertEqual(call.input_tokens, len(self.provider_requests[0]["content"]) + 8192)
        self.assertEqual(call.output_tokens, 100)
        self.assertEqual(call.cost_usd, 0)

    async def test_forged_scope_identity_selection_and_budget_fail_before_io(self):
        changes = {"run_id": uuid4(), "workspace_id": uuid4(), "project_id": uuid4(),
            "initiated_by": uuid4(), "credential_id": uuid4(), "model": "gpt-6-sol",
            "reasoning_effort": ReasoningEffort.HIGH, "max_input_tokens": 100001,
            "max_output_tokens": 401, "max_model_calls": 5}
        for key, value in changes.items():
            with self.subTest(field=key), self.assertRaisesRegex(PlatformBudgetError, "BYOK_SCOPE_MISMATCH"):
                forged = self.request.model_copy(update={"byok_budget": self.request.byok_budget.model_copy(update={key: value})})
                ByokExecutionLedger(forged, delegation_token="synthetic-delegation")
        self.assertFalse(self.admissions)
        self.resolve.assert_not_awaited()

    async def test_unbounded_payload_and_unsupported_operations_fail_before_io(self):
        original = payload(self.request.model_selection)
        variants = [{**original, "tools": [{"type": "web_search"}]},
            {**original, "service_tier": "priority"}, {**original, "store": True},
            {**original, "input": [{"role": "user", "content": [{"type": "input_image"}]}]},
            {**original, "extra_headers": {"Authorization": "Bearer synthetic-ambient"}},
            {**original, "model": "gpt-6-astra"}]
        with byok_budget_scope(self.ledger):
            for value in variants:
                with self.subTest(payload=value), self.assertRaises(PlatformBudgetError):
                    await self.invoke(value)
            for operation in ("pet_profile", "quotation_assumption", "route_evaluation", "RAPTOR", "WEB_RESEARCH", "A2A"):
                with self.subTest(operation=operation), self.assertRaisesRegex(PlatformBudgetError, "BYOK_OPERATION_UNSUPPORTED"):
                    await self.invoke(operation=operation)
        self.assertFalse(self.admissions)
        self.resolve.assert_not_awaited()
        self.assertFalse(self.provider_requests)

    async def test_ambiguous_admission_is_never_retried_or_sent_to_provider(self):
        async def lost_response():
            raise TimeoutError("synthetic lost response")
        self.before_admission = lost_response
        with byok_budget_scope(self.ledger):
            with self.assertRaisesRegex(PlatformBudgetError, "BYOK_ADMISSION_FAILED"):
                await self.invoke()
            with self.assertRaisesRegex(PlatformBudgetError, "BYOK_SCOPE_CLOSED"):
                await self.invoke()
        self.assertEqual(len(self.admissions), 1)
        self.resolve.assert_not_awaited()
        self.assertFalse(self.provider_requests)

    async def test_mismatched_admission_ack_blocks_provider(self):
        self.admission_body = {"callId": str(uuid4()), "admitted": True,
            "validUntil": self.request.byok_budget.valid_until.isoformat(),
            "fundingSource": "BYOK", "serviceTier": "default"}
        with byok_budget_scope(self.ledger), self.assertRaisesRegex(PlatformBudgetError, "BYOK_ADMISSION_FAILED"):
            await self.invoke()
        self.resolve.assert_not_awaited()
        self.assertFalse(self.provider_payloads)

    async def test_detached_context_after_parent_closes_cannot_call_provider(self):
        release = asyncio.Event()
        async def delayed():
            await release.wait()
            return await self.invoke()
        with byok_budget_scope(self.ledger):
            task = asyncio.create_task(delayed())
        release.set()
        with self.assertRaisesRegex(PlatformBudgetError, "BYOK_SCOPE_CLOSED"):
            await task
        self.assertFalse(self.admissions)
        self.assertFalse(self.provider_payloads)

    async def assert_delay_boundary_rejected(self, stage: str, *, expires: bool = False):
        entered, release = asyncio.Event(), asyncio.Event()
        async def pause(*_):
            entered.set()
            await release.wait()
            return "synthetic-personal-key"
        if stage == "admission":
            self.before_admission = pause
        elif stage == "persistence":
            self.persist.side_effect = pause
        elif stage == "credential":
            self.resolve.side_effect = pause
        elif stage == "http_context":
            self.before_client_enter = pause
        scope = byok_budget_scope(self.ledger)
        scope.__enter__()
        task = asyncio.create_task(self.invoke())
        try:
            await asyncio.wait_for(entered.wait(), timeout=1)
            if expires:
                clock = self.stack.enter_context(patch.object(byok_budget, "datetime", wraps=datetime))
                clock.now.return_value = self.request.byok_budget.valid_until + timedelta(seconds=1)
            else:
                scope.__exit__(None, None, None)
                scope = None
            release.set()
            with self.assertRaisesRegex(PlatformBudgetError, "BYOK_BUDGET_EXPIRED" if expires else "BYOK_SCOPE_CLOSED"):
                await task
            self.assertFalse(self.provider_payloads)
        finally:
            release.set()
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            if scope is not None:
                scope.__exit__(None, None, None)

    async def test_close_while_admission_pending(self):
        await self.assert_delay_boundary_rejected("admission")

    async def test_close_while_persistence_pending(self):
        await self.assert_delay_boundary_rejected("persistence")

    async def test_close_while_credential_pending(self):
        await self.assert_delay_boundary_rejected("credential")

    async def test_close_while_http_context_pending(self):
        await self.assert_delay_boundary_rejected("http_context")

    async def test_expiry_while_credential_pending(self):
        await self.assert_delay_boundary_rejected("credential", expires=True)

    async def test_revoked_key_next_attempt_retains_bound_and_never_falls_back(self):
        self.resolve.side_effect = ["synthetic-personal-key", ValueError("Personal credential unavailable")]
        with byok_budget_scope(self.ledger):
            await self.invoke()
            with self.assertRaisesRegex(PlatformBudgetError, "BYOK_CREDENTIAL_UNAVAILABLE"):
                await self.invoke()
        self.assertEqual(self.resolve.await_count, 2)
        self.assertEqual(len(self.admissions), 2)
        self.assertEqual(len(self.ledger.calls), 2)
        self.assertEqual(len(self.provider_requests), 1)
        self.assertEqual(len(self.provider_payloads), 1)
        self.assertEqual(self.ledger.report(None).output_tokens, 200)

    async def test_concurrent_response_uses_its_own_reservation(self):
        first_started, release_first = asyncio.Event(), asyncio.Event()
        async def interleave(value):
            if value["max_output_tokens"] == 10:
                first_started.set()
                await release_first.wait()
                # Invalid for first call, valid for second call: catches calls[-1] bugs.
                return SimpleNamespace(model=self.request.model_selection.model, service_tier="default",
                    usage=SimpleNamespace(input_tokens=10, output_tokens=20))
            return SimpleNamespace(model=self.request.model_selection.model, service_tier="default",
                usage=SimpleNamespace(input_tokens=10, output_tokens=1))
        self.before_provider = interleave
        with byok_budget_scope(self.ledger):
            first = asyncio.create_task(self.invoke(payload(self.request.model_selection, output=10)))
            await asyncio.wait_for(first_started.wait(), timeout=1)
            await self.invoke(payload(self.request.model_selection, output=100))
            release_first.set()
            with self.assertRaisesRegex(PlatformBudgetError, "BYOK_RESPONSE_USAGE_INVALID"):
                await first
        self.assertEqual(len(self.provider_payloads), 2)

    async def test_ambient_sdk_headers_cannot_override_selected_credential(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-platform-key",
                "OPENAI_ORG_ID": "synthetic-platform-org", "OPENAI_PROJECT_ID": "synthetic-platform-project",
                "OPENAI_BASE_URL": "https://attacker.invalid/v1",
                "OPENAI_CUSTOM_HEADERS": "Authorization: Bearer synthetic-platform-key"}), byok_budget_scope(self.ledger):
            await self.invoke()
        self.assertEqual(self.provider_requests[0]["url"], "https://api.openai.com/v1/responses")
        self.assertEqual(self.provider_requests[0]["headers"], {
            "Authorization": "Bearer synthetic-personal-key", "Content-Type": "application/json"})

    async def test_approved_150k_is_aggregate_across_all_attempts_and_resume(self):
        budget = self.request.budget.model_copy(update={"max_input_tokens": 150000,
            "max_model_calls": 50, "max_output_tokens": 48000, "max_duration_seconds": 180, "max_retries": 2})
        scope = self.request.byok_budget.model_copy(update={"budget": budget, "max_input_tokens": 150000,
            "max_model_calls": 50, "max_output_tokens": 48000})
        self.request = self.request.model_copy(update={"budget": budget, "byok_budget": scope})
        self.ledger = ByokExecutionLedger(self.request, delegation_token="synthetic-delegation")
        self.ledger.persist_usage = self.persist
        value = payload(self.request.model_selection)
        value["input"][0]["content"] = ""
        overhead = len(byok_budget.encode_payload(value)) + 8192
        value["input"][0]["content"] = "a" * (30000 - overhead)
        with byok_budget_scope(self.ledger):
            for _ in range(5):
                await self.invoke(value)
            with self.assertRaisesRegex(PlatformBudgetError, "INPUT_TOKEN_BUDGET_EXCEEDED"):
                await self.invoke(value)
        previous = self.ledger.report(None)
        self.assertEqual(previous.input_tokens, 150000)
        self.assertEqual(previous.model_calls, 5)
        self.assertEqual(sum(item["body"]["inputTokens"] for item in self.admissions), 150000)
        resumed = ByokExecutionLedger(self.request, previous, "synthetic-delegation")
        resumed.persist_usage = self.persist
        with byok_budget_scope(resumed), self.assertRaisesRegex(PlatformBudgetError, "INPUT_TOKEN_BUDGET_EXCEEDED"):
            await self.invoke(value)
        self.assertEqual(len(self.admissions), 5)
        self.assertEqual(len(self.provider_requests), 5)

    async def test_usage_records_contain_no_keys_or_bearer(self):
        with byok_budget_scope(self.ledger):
            await self.invoke()
        saved = json.dumps([call.args[0].model_dump(mode="json") for call in self.persist.await_args_list])
        self.assertNotIn("synthetic-personal-key", saved)
        self.assertNotIn("synthetic-delegation", saved)
        self.assertNotIn("Authorization", saved)


if __name__ == "__main__":
    unittest.main()
