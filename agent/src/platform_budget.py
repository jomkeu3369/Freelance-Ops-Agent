"""Run-scoped monetary admission and attempt accounting for platform providers.

The backend retains active reservations in their admission period and releases unused
capacity only after worker closure. Unknown outcomes retain their pre-call upper bound.
This in-process ledger is shared by child coroutines; detached workers are deliberately
unsupported until durable admission is available. No user request or environment flag can turn admission off.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_CEILING, Decimal
from typing import Any
from uuid import UUID, uuid4

from contracts import (
    AgentRunUsage,
    ModelSelection,
    PlatformBudget,
    Provider,
    ProviderCallUsage,
    ReasoningEffort,
    RequestTier,
    RunBudget,
)

LEGACY_TARIFF_VERSION = "platform-ai-2026-10-04-v1"
TARIFF_VERSION = "platform-ai-2026-10-05-v2"
_MILLION = Decimal("1000000")
_USD_PRECISION = Decimal("0.00000001")
_PROTOCOL_TOKEN_ALLOWANCE = 8192
_MAX_STANDARD_INPUT_TOKENS = 272000


class PlatformBudgetError(RuntimeError):
    """Stable fail-closed code; contains no prompt or credential material."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Tariff:
    input: Decimal
    cached_read: Decimal
    cache_write: Decimal
    output: Decimal


# Exact provider/model pairs only. No alias, prefix matching, or fallback pricing.
LEGACY_TARIFFS = {
    (Provider.OPENAI, "gpt-5.6-luna"): Tariff(Decimal("0.20"), Decimal("0.02"), Decimal("0.25"), Decimal("1.20")),
    (Provider.OPENAI, "gpt-5.6-terra"): Tariff(Decimal("2.00"), Decimal("0.20"), Decimal("2.50"), Decimal("12.00")),
}
TARIFFS = {
    **LEGACY_TARIFFS,
    (Provider.OPENAI, "gpt-6-luna"): Tariff(Decimal(".10"), Decimal(".01"), Decimal(".125"), Decimal(".50")),
    (Provider.OPENAI, "gpt-6-sol"): Tariff(Decimal("2"), Decimal(".20"), Decimal("2.50"), Decimal("10")),
    (Provider.OPENAI, "gpt-6.1-sol"): Tariff(Decimal("2"), Decimal(".10"), Decimal("2.50"), Decimal("10")),
    (Provider.OPENAI, "gpt-6-astra"): Tariff(Decimal("10"), Decimal("1"), Decimal("12.50"), Decimal("50")),
    (Provider.OPENAI, "gpt-5.6-sol"): Tariff(Decimal("4"), Decimal(".40"), Decimal("5"), Decimal("20")),
}
TARIFF_VERSIONS = {LEGACY_TARIFF_VERSION: LEGACY_TARIFFS, TARIFF_VERSION: TARIFFS}
# Re-review the promotional Sol tariff before admitting calls after this date.
PROMOTION_REVIEW_AT = datetime(2026, 11, 22, tzinfo=UTC)


def validate_reasoning(selection: ModelSelection) -> None:
    if (selection.provider is Provider.OPENAI and selection.model in {"gpt-6.1-sol", "gpt-6-astra"}
            and selection.reasoning_effort is ReasoningEffort.NONE):
        raise PlatformBudgetError("MODEL_REASONING_UNSUPPORTED")


class PlatformSpendLedger:
    def __init__(self, budget: PlatformBudget, previous: AgentRunUsage | None = None,
                 run_budget: RunBudget | None = None) -> None:
        self.budget = budget
        self.calls: list[ProviderCallUsage] = []
        self.blocked = False
        self.closed = False
        self.unpriced_exposure = previous.unpriced_exposure if previous is not None else False
        self.run_budget = run_budget
        self.previous = previous
        self.persist_usage: Callable[[AgentRunUsage], Awaitable[None]] | None = None
        self.previous_cost = previous.platform_cost_usd if previous is not None else Decimal("0")
        if previous is not None and previous.platform_reservation_id not in {None, budget.reservation_id}:
            raise PlatformBudgetError("PLATFORM_RESERVATION_MISMATCH")
        if previous is not None and previous.tariff_version not in {None, budget.tariff_version}:
            raise PlatformBudgetError("PLATFORM_TARIFF_MISMATCH")
        if previous is not None and previous.model_calls and previous.platform_reservation_id is None:
            raise PlatformBudgetError("PLATFORM_PRIOR_USAGE_UNKNOWN")

    @property
    def cost(self) -> Decimal:
        return sum((call.cost_usd for call in self.calls), Decimal("0"))

    def validate(self) -> None:
        if self.closed:
            raise PlatformBudgetError("PLATFORM_BUDGET_SCOPE_CLOSED")
        if self.budget.tariff_version not in TARIFF_VERSIONS:
            raise PlatformBudgetError("PLATFORM_TARIFF_UNSUPPORTED")
        if datetime.now(UTC) >= self.budget.valid_until:
            raise PlatformBudgetError("PLATFORM_BUDGET_EXPIRED")
        if self.blocked or self.previous_cost + self.cost > self.budget.max_cost_usd:
            raise PlatformBudgetError("PLATFORM_BUDGET_EXCEEDED")

    def reserve(self, selection: ModelSelection, operation: str, payload: Mapping[str, Any], output_limit: int) -> int:
        self.validate()
        validate_reasoning(selection)
        if selection.credential_id is not None:
            raise PlatformBudgetError("BYOK_BUDGET_REQUIRED")
        byok = False
        tariff = TARIFF_VERSIONS[self.budget.tariff_version].get((selection.provider, selection.model))
        if tariff is None and not byok:
            raise PlatformBudgetError("PLATFORM_MODEL_UNPRICED")
        if not byok and selection.model == "gpt-5.6-sol" and datetime.now(UTC) >= PROMOTION_REVIEW_AT:
            raise PlatformBudgetError("PLATFORM_TARIFF_REVIEW_REQUIRED")
        if output_limit < 1:
            raise PlatformBudgetError("PLATFORM_OUTPUT_LIMIT_REQUIRED")
        # Text-only request bytes bound the tokenizer input conservatively, including
        # the complete schema and system prompt, plus protocol framing allowance.
        # Multimodal/built-in-tool requests must not use this admission function.
        input_limit = len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) + _PROTOCOL_TOKEN_ALLOWANCE
        if input_limit > _MAX_STANDARD_INPUT_TOKENS:
            raise PlatformBudgetError("PLATFORM_LONG_CONTEXT_UNPRICED")
        if self.run_budget is not None:
            previous_calls = self.previous.model_calls if self.previous is not None else 0
            previous_input = self.previous.input_tokens if self.previous is not None else 0
            previous_output = self.previous.output_tokens if self.previous is not None else 0
            if previous_calls + len(self.calls) + 1 > self.run_budget.max_model_calls:
                raise PlatformBudgetError("MODEL_CALL_BUDGET_EXCEEDED")
            if previous_input + sum(call.input_tokens for call in self.calls) + input_limit > self.run_budget.max_input_tokens:  # noqa: E501
                raise PlatformBudgetError("INPUT_TOKEN_BUDGET_EXCEEDED")
            if previous_output + sum(call.output_tokens for call in self.calls) + output_limit > self.run_budget.max_output_tokens:  # noqa: E501
                raise PlatformBudgetError("OUTPUT_TOKEN_BUDGET_EXCEEDED")
        reserved = Decimal("0")
        if not byok:
            assert tariff is not None
            reserved = (Decimal(input_limit) * max(tariff.input, tariff.cache_write)
                        + Decimal(output_limit) * tariff.output) / _MILLION
            reserved = reserved.quantize(_USD_PRECISION, rounding=ROUND_CEILING)
        if self.previous_cost + self.cost + reserved > self.budget.max_cost_usd:
            raise PlatformBudgetError("PLATFORM_BUDGET_EXCEEDED")
        self.calls.append(ProviderCallUsage(
            call_id=uuid4(), provider=selection.provider, model=selection.model, operation=operation,
            funding_source="BYOK" if byok else "PLATFORM",
            input_tokens=input_limit, output_tokens=output_limit, cost_usd=reserved,
            reserved_cost_usd=reserved, usage_known=False,
        ))
        return len(self.calls) - 1

    def settle_openai(self, index: int, response: Any) -> None:
        call = self.calls[index]
        if getattr(response, "service_tier", "default") != "default":
            self.blocked = True
            self.unpriced_exposure = True
            raise PlatformBudgetError("PLATFORM_RESPONSE_TIER_MISMATCH")
        returned_model = getattr(response, "model", call.model)
        if returned_model != call.model:
            self.blocked = True
            self.unpriced_exposure = True
            raise PlatformBudgetError("PLATFORM_RESPONSE_MODEL_MISMATCH")
        usage = getattr(response, "usage", None)
        input_tokens = _token_count(usage, "input_tokens")
        output_tokens = _token_count(usage, "output_tokens")
        details = getattr(usage, "input_tokens_details", None)
        cached = _token_count(details, "cached_tokens")
        written = _token_count(details, "cache_write_tokens")
        if None in (input_tokens, output_tokens, cached, written):
            return  # Missing or malformed usage keeps its original upper bound.
        assert input_tokens is not None and output_tokens is not None and cached is not None and written is not None
        if cached + written > input_tokens:
            self.blocked = True
            self.unpriced_exposure = True
            raise PlatformBudgetError("PLATFORM_USAGE_INVALID")
        cost = Decimal("0")
        if call.funding_source == "PLATFORM":
            tariff = TARIFF_VERSIONS[self.budget.tariff_version][(call.provider, call.model)]
            cost = (Decimal(input_tokens - cached - written) * tariff.input + Decimal(cached) * tariff.cached_read
                    + Decimal(written) * tariff.cache_write + Decimal(output_tokens) * tariff.output) / _MILLION
            cost = cost.quantize(_USD_PRECISION, rounding=ROUND_CEILING)
        # Output tokens already include reasoning; never add reasoning_tokens again.
        drift = (input_tokens > call.input_tokens or input_tokens > _MAX_STANDARD_INPUT_TOKENS
                 or output_tokens > call.output_tokens or cost > call.reserved_cost_usd)
        self.calls[index] = call.model_copy(update={
            "input_tokens": input_tokens, "output_tokens": output_tokens,
            "cached_read_tokens": cached, "cache_write_tokens": written,
            "cost_usd": max(call.reserved_cost_usd, cost) if drift else cost,
            "usage_known": not drift,
        })
        if drift:
            self.blocked = True
            self.unpriced_exposure = True
            raise PlatformBudgetError("PLATFORM_USAGE_BOUND_EXCEEDED")

    def report(self, usage: AgentRunUsage | None) -> AgentRunUsage:
        if usage is None:
            usage = AgentRunUsage(request_tier=RequestTier.SINGLE_AGENT, model_calls=0, tool_calls=0,
                                  input_tokens=0, output_tokens=0, duration_ms=0)
        return usage.model_copy(update={
            "provider_calls": list(self.calls), "platform_cost_usd": self.cost,
            "platform_reservation_id": self.budget.reservation_id, "tariff_version": self.budget.tariff_version,
            "execution_closed": self.closed,
            "unpriced_exposure": self.unpriced_exposure,
            "model_calls": len(self.calls), "input_tokens": sum(call.input_tokens for call in self.calls),
            "output_tokens": sum(call.output_tokens for call in self.calls),
            "cached_tokens": sum(call.cached_read_tokens for call in self.calls),
        })


def _token_count(value: Any, name: str, default: int | None = None) -> int | None:
    raw = getattr(value, name, default)
    return raw if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0 else None


_ledger: ContextVar[PlatformSpendLedger | None] = ContextVar("platform_spend_ledger", default=None)
_offline_test_scope: ContextVar[bool] = ContextVar("offline_provider_test_scope", default=False)


def current_ledger() -> PlatformSpendLedger | None:
    return _ledger.get()


@contextmanager
def platform_budget_scope(ledger: PlatformSpendLedger | None) -> Iterator[None]:
    owns_scope = current_ledger() is not ledger
    token = _ledger.set(ledger)
    try:
        yield
    finally:
        if ledger is not None and owns_scope:
            ledger.closed = True
        _ledger.reset(token)


@contextmanager
def offline_provider_test_scope(enabled: bool = True) -> Iterator[None]:
    """Explicit Python-only seam for legacy offline mocks; never an API/config input."""
    token = _offline_test_scope.set(enabled)
    try:
        yield
    finally:
        _offline_test_scope.reset(token)


def require_platform_ledger() -> PlatformSpendLedger | None:
    ledger = current_ledger()
    if ledger is None and not _offline_test_scope.get():
        raise PlatformBudgetError("PLATFORM_BUDGET_REQUIRED")
    return ledger


def reject_unbounded_operation(operation: str) -> None:
    from byok_budget import current_byok_ledger
    if current_byok_ledger() is not None:
        raise PlatformBudgetError(f"BYOK_{operation}_UNSUPPORTED")
    if require_platform_ledger() is not None:
        raise PlatformBudgetError(f"PLATFORM_{operation}_UNPRICED")


async def budgeted_openai_attempt(client: Any, selection: ModelSelection, operation: str,
                                  payload: dict[str, Any], *, client_credential_id: UUID | None = None) -> Any:
    from byok_budget import current_byok_ledger
    if current_byok_ledger() is not None:
        raise PlatformBudgetError("BYOK_AMBIENT_CLIENT_FORBIDDEN")
    ledger = require_platform_ledger()
    if ledger is None:
        return await client.responses.create(**payload)
    if selection.credential_id != client_credential_id:
        raise PlatformBudgetError("PLATFORM_CREDENTIAL_BINDING_MISMATCH")
    if str(getattr(client, "base_url", "")).rstrip("/") != "https://api.openai.com/v1":
        raise PlatformBudgetError("PLATFORM_ENDPOINT_UNPRICED")
    if payload.get("service_tier") != "default":
        raise PlatformBudgetError("PLATFORM_SERVICE_TIER_UNPRICED")
    if getattr(client, "max_retries", 0) != 0:
        raise PlatformBudgetError("PLATFORM_SDK_RETRIES_UNBOUNDED")
    messages = payload.get("input")
    allowed_keys = {"model", "service_tier", "reasoning", "input", "tools", "store", "max_output_tokens", "text"}
    if (set(payload) - allowed_keys or payload.get("tools") != [] or payload.get("model") != selection.model
            or not isinstance(messages, list)
            or any(not isinstance(item, dict) or not isinstance(item.get("content"), str) for item in messages)):
        raise PlatformBudgetError("PLATFORM_INPUT_UNBOUNDED")
    effort = payload.get("reasoning", {}).get("effort", selection.reasoning_effort.value.lower())
    if effort != selection.reasoning_effort.value.lower():
        raise PlatformBudgetError("MODEL_REASONING_MISMATCH")
    index = ledger.reserve(selection, operation, payload, int(payload["max_output_tokens"]))
    # Persist the conservative attempt before provider I/O. A crash cannot turn
    # an unreported billable attempt into free usage.
    if ledger.persist_usage is not None:
        await ledger.persist_usage(ledger.report(None))
    # SDK retries are disabled at every production client construction; this call
    # represents exactly one billable attempt. Cancellation retains its bound.
    response = await client.responses.create(**payload)
    try:
        ledger.settle_openai(index, response)
    finally:
        if ledger.persist_usage is not None:
            await ledger.persist_usage(ledger.report(None))
    return response
