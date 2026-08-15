from __future__ import annotations

import asyncio

import pytest

from contracts import ModelSelection, Provider
from gateway import AIGateway, GatewayPolicy, GatewayRejectedError
from providers import ModelGeneration, ProviderCallError


class FixedProvider:
    def __init__(self, *, failure: Exception | None = None) -> None:
        self.failure = failure
        self.calls = 0

    async def generate_structured(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        del selection, prompt, max_output_tokens, max_attempts
        self.calls += 1
        if self.failure is not None:
            raise self.failure
        return ModelGeneration(payload={"summary": "ok"}, input_tokens=11, output_tokens=3)

    async def generate_react_step(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        return await self.generate_structured(
            selection,
            prompt,
            max_output_tokens=max_output_tokens,
            max_attempts=max_attempts
        )


class BlockingProvider(FixedProvider):
    def __init__(self) -> None:
        super().__init__()
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def generate_structured(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        del selection, prompt, max_output_tokens, max_attempts
        self.calls += 1
        self.started.set()
        await self.release.wait()
        return ModelGeneration(payload={"summary": "ok"})


def selection(model: str = "gpt-test") -> ModelSelection:
    return ModelSelection(provider=Provider.OPENAI, model=model)


@pytest.mark.asyncio
async def test_gateway_records_content_free_usage_metrics() -> None:
    provider = FixedProvider()
    gateway = AIGateway(provider, policy=GatewayPolicy())

    result = await gateway.generate_structured(selection(), "private prompt", max_output_tokens=100)

    assert result.payload == {"summary": "ok"}
    snapshot = gateway.telemetry.snapshot()
    assert snapshot.total_calls == 1
    assert snapshot.successful_calls == 1
    assert snapshot.input_tokens == 11
    assert snapshot.output_tokens == 3
    assert snapshot.outcomes == {"SUCCESS": 1}
    assert "private prompt" not in repr(snapshot)


@pytest.mark.asyncio
async def test_gateway_rejects_model_outside_allowlist_without_calling_provider() -> None:
    provider = FixedProvider()
    gateway = AIGateway(
        provider,
        policy=GatewayPolicy(allowed_models=frozenset({"approved-model"}))
    )

    with pytest.raises(GatewayRejectedError, match="not allowed"):
        await gateway.generate_structured(selection("unapproved-model"), "prompt", max_output_tokens=100)

    assert provider.calls == 0
    assert gateway.telemetry.snapshot().outcomes == {"MODEL_NOT_ALLOWED": 1}


@pytest.mark.asyncio
async def test_gateway_opens_circuit_after_consecutive_provider_failures() -> None:
    provider = FixedProvider(failure=ProviderCallError("provider unavailable"))
    gateway = AIGateway(
        provider,
        policy=GatewayPolicy(circuit_failure_threshold=2, circuit_recovery_seconds=60)
    )

    for _ in range(2):
        with pytest.raises(ProviderCallError):
            await gateway.generate_structured(selection(), "prompt", max_output_tokens=100)

    with pytest.raises(GatewayRejectedError, match="circuit is open"):
        await gateway.generate_structured(selection(), "prompt", max_output_tokens=100)

    assert provider.calls == 2
    assert gateway.telemetry.snapshot().outcomes == {"PROVIDER_FAILURE": 2, "CIRCUIT_OPEN": 1}


@pytest.mark.asyncio
async def test_gateway_rejects_excess_concurrency_after_bounded_wait() -> None:
    provider = BlockingProvider()
    gateway = AIGateway(
        provider,
        policy=GatewayPolicy(max_concurrency=1, acquire_timeout_seconds=0.01)
    )

    first = asyncio.create_task(
        gateway.generate_structured(selection(), "first", max_output_tokens=100)
    )
    await provider.started.wait()
    try:
        with pytest.raises(GatewayRejectedError, match="capacity is exhausted"):
            await gateway.generate_structured(selection(), "second", max_output_tokens=100)
    finally:
        provider.release.set()
        await first

    assert provider.calls == 1
    assert gateway.telemetry.snapshot().outcomes == {"GATEWAY_CAPACITY_EXCEEDED": 1, "SUCCESS": 1}


@pytest.mark.asyncio
async def test_gateway_releases_capacity_and_metrics_when_call_is_cancelled() -> None:
    provider = BlockingProvider()
    gateway = AIGateway(provider, policy=GatewayPolicy(max_concurrency=1))
    task = asyncio.create_task(
        gateway.generate_structured(selection(), "cancelled", max_output_tokens=100)
    )
    await provider.started.wait()

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    snapshot = gateway.telemetry.snapshot()
    assert snapshot.inflight_calls == 0
    assert snapshot.outcomes == {"CALL_CANCELLED": 1}
