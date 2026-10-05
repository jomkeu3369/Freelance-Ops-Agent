"""Fail-closed personal-key execution with backend-owned durable attempt admission.

Scope data is not a capability. Every network attempt first consumes an immutable
backend reservation and a durable local record. Reservations are never refunded,
including timeouts, cancellation, unknown responses and process death. No credentials
or delegation tokens enter persisted models; HTTP clients live for one attempt only, without ambient SDK configuration.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

import httpx

from config import get_settings
from contracts import (
    AgentRunRequest,
    AgentRunUsage,
    AgentWorkflowMode,
    ModelSelection,
    Provider,
    ProviderCallUsage,
    RequestTier,
)
from personal_credentials import resolve_credential
from platform_budget import PlatformBudgetError, current_ledger, require_platform_ledger, validate_reasoning

_OPERATIONS = frozenset({"department_work_product", "bounded_react_step"})
_PROTOCOL_ALLOWANCE = 8192
_MAX_INPUT = 272000


def encode_payload(payload: dict[str, Any]) -> bytes:
    """The exact UTF-8 bytes counted for admission and transmitted to OpenAI."""
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


class ByokProviderHTTPError(RuntimeError):
    def __init__(self, status_code: int) -> None:
        super().__init__("personal provider HTTP failure")
        self.status_code = status_code


class ByokExecutionLedger:
    def __init__(self, request: AgentRunRequest, previous: AgentRunUsage | None = None,
                 delegation_token: str | None = None) -> None:
        self.request = request
        self.budget = request.byok_budget
        self.previous = previous
        self._delegation_token = delegation_token
        self.calls: list[ProviderCallUsage] = []
        self.closed = False
        self.blocked = False
        self.persist_usage: Callable[[AgentRunUsage], Awaitable[None]] | None = None
        self._lock = asyncio.Lock()
        self.validate()
        assert self.budget is not None
        if previous is not None and (
            previous.byok_scope_id not in {None, self.budget.scope_id}
            or previous.platform_reservation_id is not None
            or previous.model_calls and previous.byok_scope_id is None
            or any(call.funding_source != "BYOK" for call in previous.provider_calls)
        ):
            raise PlatformBudgetError("BYOK_PRIOR_USAGE_MISMATCH")

    def validate(self, selection: ModelSelection | None = None) -> None:
        scope = self.budget
        request = self.request
        if self.closed or self.blocked:
            raise PlatformBudgetError("BYOK_SCOPE_CLOSED")
        if scope is None:
            raise PlatformBudgetError("BYOK_BUDGET_REQUIRED")
        if request.platform_budget is not None or current_ledger() is not None:
            raise PlatformBudgetError("BYOK_FUNDING_MISMATCH")
        context = request.context
        chosen = selection or request.model_selection
        if ((scope.run_id, scope.workspace_id, scope.project_id, scope.initiated_by)
                != (context.run_id, context.workspace_id, context.project_id, context.initiated_by)
                or (scope.credential_id, scope.provider, scope.model, scope.reasoning_effort)
                != (chosen.credential_id, chosen.provider, chosen.model, chosen.reasoning_effort)
                or request.model_selection != chosen or scope.budget != request.budget
                or (scope.max_model_calls, scope.max_input_tokens, scope.max_output_tokens)
                != (request.budget.max_model_calls, request.budget.max_input_tokens, request.budget.max_output_tokens)
                or scope.funding_source != "BYOK" or scope.service_tier != "default"):
            raise PlatformBudgetError("BYOK_SCOPE_MISMATCH")
        if scope.provider is not Provider.OPENAI:
            raise PlatformBudgetError("BYOK_PROVIDER_UNSUPPORTED")
        if datetime.now(UTC) >= scope.valid_until:
            raise PlatformBudgetError("BYOK_BUDGET_EXPIRED")
        validate_reasoning(chosen)

    def remaining_seconds(self) -> float:
        self.validate()
        assert self.budget is not None
        return (self.budget.valid_until - datetime.now(UTC)).total_seconds()

    def output_limit(self, requested: int) -> int:
        self.validate()
        assert self.budget is not None
        # Reserve room for each planned department and its allowed retries. The
        # call ceiling is a ceiling, not a requirement to divide output 50 ways.
        departments = 4 if self.request.input.workflow_mode is AgentWorkflowMode.PROJECT_ANALYSIS else 1
        planned = min(self.budget.max_model_calls, departments * (self.budget.budget.max_retries + 1))
        limit = min(requested, self.budget.max_output_tokens // planned)
        if limit < 1:
            raise PlatformBudgetError("OUTPUT_TOKEN_BUDGET_EXCEEDED")
        return limit

    def preflight(self, payloads: list[dict[str, Any]]) -> None:
        self.validate()
        assert self.budget is not None
        prior = self.previous
        calls = (prior.model_calls if prior else 0) + len(self.calls)
        inputs = (prior.input_tokens if prior else 0) + sum(call.input_tokens for call in self.calls)
        outputs = (prior.output_tokens if prior else 0) + sum(call.output_tokens for call in self.calls)
        if calls + len(payloads) > self.budget.max_model_calls:
            raise PlatformBudgetError("BYOK_PLAN_MODEL_CALL_BUDGET_EXCEEDED")
        if inputs + sum(len(encode_payload(payload)) + _PROTOCOL_ALLOWANCE for payload in payloads) > self.budget.max_input_tokens:  # noqa: E501
            raise PlatformBudgetError("BYOK_PLAN_INPUT_BUDGET_EXCEEDED")
        if outputs + sum(payload["max_output_tokens"] for payload in payloads) > self.budget.max_output_tokens:
            raise PlatformBudgetError("BYOK_PLAN_OUTPUT_BUDGET_EXCEEDED")

    async def reserve(self, selection: ModelSelection, operation: str, payload: dict[str, Any]) -> ProviderCallUsage:
        async with self._lock:
            self.validate(selection)
            assert self.budget is not None
            if operation not in _OPERATIONS:
                raise PlatformBudgetError("BYOK_OPERATION_UNSUPPORTED")
            if not self._delegation_token:
                raise PlatformBudgetError("BYOK_AUTHORIZATION_REQUIRED")
            if self.persist_usage is None:
                raise PlatformBudgetError("BYOK_DURABLE_STORE_REQUIRED")
            output = payload.get("max_output_tokens")
            if not isinstance(output, int) or isinstance(output, bool) or output < 1:
                raise PlatformBudgetError("BYOK_OUTPUT_LIMIT_REQUIRED")
            inputs = len(encode_payload(payload)) + _PROTOCOL_ALLOWANCE
            if inputs > _MAX_INPUT:
                raise PlatformBudgetError("BYOK_INPUT_BOUND_EXCEEDED")
            prior = self.previous
            calls = (prior.model_calls if prior else 0) + len(self.calls)
            used_input = (prior.input_tokens if prior else 0) + sum(call.input_tokens for call in self.calls)
            used_output = (prior.output_tokens if prior else 0) + sum(call.output_tokens for call in self.calls)
            if calls + 1 > self.budget.max_model_calls:
                raise PlatformBudgetError("MODEL_CALL_BUDGET_EXCEEDED")
            if used_input + inputs > self.budget.max_input_tokens:
                raise PlatformBudgetError("INPUT_TOKEN_BUDGET_EXCEEDED")
            if used_output + output > self.budget.max_output_tokens:
                raise PlatformBudgetError("OUTPUT_TOKEN_BUDGET_EXCEEDED")
            call_id = uuid4()
            settings = get_settings()
            try:
                async with httpx.AsyncClient(timeout=min(settings.backend_tool_timeout_seconds,
                                                          self.remaining_seconds()),
                                             follow_redirects=False, trust_env=False) as client:
                    response = await client.post(
                        f"{settings.backend_internal_url.rstrip('/')}/internal/v1/byok-executions/"
                        f"{self.budget.scope_id}/attempts",
                        headers={"Authorization": f"Bearer {self._delegation_token}",
                                 "X-Run-Id": str(self.budget.run_id)},
                        json={"callId": str(call_id), "credentialId": str(selection.credential_id),
                              "provider": selection.provider.value, "model": selection.model,
                              "reasoningEffort": selection.reasoning_effort.value,
                              "operation": operation, "fundingSource": "BYOK", "serviceTier": "default",
                              "inputTokens": inputs, "maxOutputTokens": output},
                    )
                body = response.json()
                if (response.status_code != 200 or body.get("admitted") is not True
                        or body.get("callId") != str(call_id)
                        or body.get("fundingSource") != "BYOK" or body.get("serviceTier") != "default"
                        or datetime.fromisoformat(body["validUntil"].replace("Z", "+00:00"))
                        != self.budget.valid_until):
                    raise ValueError("invalid admission")
            except Exception:
                # A lost response may have consumed a reservation. Never retry
                # admission blindly, and never let provider retry classify it.
                self.blocked = True
                raise PlatformBudgetError("BYOK_ADMISSION_FAILED") from None
            self.validate(selection)
            self.calls.append(ProviderCallUsage(
                call_id=call_id, provider=selection.provider, model=selection.model, operation=operation,
                funding_source="BYOK", input_tokens=inputs, output_tokens=output,
                cost_usd=Decimal("0"), reserved_cost_usd=Decimal("0"), usage_known=False,
            ))
            try:
                await self.persist_usage(self.report(None))
            except Exception:
                self.blocked = True
                raise PlatformBudgetError("BYOK_PERSISTENCE_FAILED") from None
            self.validate(selection)
            return self.calls[-1]

    def check_response(self, response: Any, call: ProviderCallUsage) -> None:
        assert self.budget is not None
        if (getattr(response, "model", None) != self.budget.model
                or getattr(response, "service_tier", None) != "default"):
            self.blocked = True
            raise PlatformBudgetError("BYOK_RESPONSE_BINDING_MISMATCH")
        # The durable conservative reservation remains consumed even when actual
        # usage is known. Any provider bound violation stops all further attempts.
        usage = getattr(response, "usage", None)
        for name, upper in (("input_tokens", call.input_tokens), ("output_tokens", call.output_tokens)):
            value = getattr(usage, name, None)
            if value is not None and (not isinstance(value, int) or isinstance(value, bool)
                                      or value < 0 or value > upper):
                self.blocked = True
                raise PlatformBudgetError("BYOK_RESPONSE_USAGE_INVALID")

    def report(self, usage: AgentRunUsage | None) -> AgentRunUsage:
        assert self.budget is not None
        if usage is None:
            usage = AgentRunUsage(request_tier=RequestTier.SINGLE_AGENT, model_calls=0, tool_calls=0,
                                  input_tokens=0, output_tokens=0, duration_ms=0)
        return usage.model_copy(update={
            "byok_scope_id": self.budget.scope_id, "provider_calls": list(self.calls),
            "platform_cost_usd": Decimal("0"), "platform_reservation_id": None, "tariff_version": None,
            "execution_closed": self.closed, "model_calls": len(self.calls),
            "input_tokens": sum(call.input_tokens for call in self.calls),
            "output_tokens": sum(call.output_tokens for call in self.calls), "cached_tokens": 0,
        })


_byok_ledger: ContextVar[ByokExecutionLedger | None] = ContextVar("byok_execution_ledger", default=None)


def current_byok_ledger() -> ByokExecutionLedger | None:
    return _byok_ledger.get()


@contextmanager
def byok_budget_scope(ledger: ByokExecutionLedger | None) -> Iterator[None]:
    owns_scope = current_byok_ledger() is not ledger
    token = _byok_ledger.set(ledger)
    try:
        yield
    finally:
        if ledger is not None and owns_scope:
            ledger.closed = True
        _byok_ledger.reset(token)


def require_generation_scope(selection: ModelSelection) -> ByokExecutionLedger | None:
    ledger = current_byok_ledger()
    if ledger is not None:
        ledger.validate(selection)
    else:
        platform = require_platform_ledger()
        if platform is not None and selection.credential_id is not None:
            raise PlatformBudgetError("BYOK_BUDGET_REQUIRED")
    return ledger


async def byok_openai_attempt(selection: ModelSelection, operation: str, payload: dict[str, Any]) -> Any:
    ledger = current_byok_ledger()
    if ledger is None:
        raise PlatformBudgetError("BYOK_BUDGET_REQUIRED")
    ledger.validate(selection)
    messages = payload.get("input")
    allowed = {"model", "service_tier", "reasoning", "input", "tools", "store", "max_output_tokens", "text"}
    if (set(payload) - allowed or payload.get("tools") != [] or payload.get("store") is not False
            or payload.get("service_tier") != "default" or payload.get("model") != selection.model
            or payload.get("reasoning") != {"effort": selection.reasoning_effort.value.lower()}
            or not isinstance(messages, list) or not messages
            or any(not isinstance(item, dict) or set(item) != {"role", "content"}
                   or item["role"] not in {"system", "user"} or not isinstance(item["content"], str)
                   for item in messages)):
        raise PlatformBudgetError("BYOK_INPUT_UNBOUNDED")
    payload = {**payload, "max_output_tokens": ledger.output_limit(payload["max_output_tokens"])}
    call = await ledger.reserve(selection, operation, payload)
    settings = get_settings()
    # Re-resolve every retry after durable admission, so revoked/replaced keys
    # cannot leave a stale personal client alive for the rest of the run.
    try:
        key = await resolve_credential(selection, settings.backend_internal_url,
                                       min(settings.backend_tool_timeout_seconds, ledger.remaining_seconds()))
    except Exception:
        raise PlatformBudgetError("BYOK_CREDENTIAL_UNAVAILABLE") from None
    ledger.validate(selection)
    # Direct Responses HTTP prevents environment SDK custom headers from
    # overriding the selected key, organization/project or provider destination.
    from openai.types.responses import Response

    async with httpx.AsyncClient(follow_redirects=False, trust_env=False,
                                 timeout=min(settings.model_timeout_seconds, ledger.remaining_seconds())) as client:
        ledger.validate(selection)
        try:
            async with asyncio.timeout(ledger.remaining_seconds()):
                raw = await client.post("https://api.openai.com/v1/responses", content=encode_payload(payload),
                                        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        except httpx.TimeoutException:
            raise TimeoutError("personal provider timeout") from None
        except httpx.HTTPError:
            raise ByokProviderHTTPError(502) from None
        finally:
            del key
    if raw.status_code != 200:
        raise ByokProviderHTTPError(raw.status_code)
    try:
        response = Response.model_validate(raw.json())
    except Exception:
        ledger.blocked = True
        raise PlatformBudgetError("BYOK_RESPONSE_INVALID") from None
    ledger.check_response(response, call)
    return response
