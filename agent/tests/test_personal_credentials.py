from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest

import personal_credentials
from contracts import ModelSelection, Provider
from gateway import AIGateway, GatewayPolicy
from personal_credentials import credential_scope, resolve_credential
from platform_budget import PlatformBudgetError
from providers import ModelGeneration, ProviderCallError, ScopedModelProvider


def selection() -> ModelSelection:
    return ModelSelection(provider=Provider.OPENAI, model="test-model", credential_id=uuid4())


async def test_credential_scope_is_reset_and_resolution_never_redirects(monkeypatch: pytest.MonkeyPatch) -> None:
    chosen = selection()
    run_id = uuid4()
    requests = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["X-Run-Id"] == str(run_id)
        assert request.headers["Authorization"] == "Bearer delegated-test"
        return httpx.Response(200, json={"apiKey": "synthetic-key"})

    original = httpx.AsyncClient
    monkeypatch.setattr(
        personal_credentials.httpx,
        "AsyncClient",
        lambda **kwargs: original(**kwargs, transport=httpx.MockTransport(respond))
    )
    with credential_scope("delegated-test", run_id):
        assert await resolve_credential(chosen, "http://backend:8080", 1) == "synthetic-key"
    with pytest.raises(ValueError, match="authorization unavailable"):
        await resolve_credential(chosen, "http://backend:8080", 1)
    assert len(requests) == 1
    assert "synthetic-key" not in str(requests[0].url)


@pytest.mark.parametrize(
    "operation", ["generate_structured", "generate_react_step", "generate_pet", "generate_assumption"]
)
async def test_unscoped_personal_connection_never_resolves_key_or_uses_platform(operation: str, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: E501
    platform = AsyncMock()
    resolver = AsyncMock()
    monkeypatch.setattr(personal_credentials, "resolve_credential", resolver)
    provider = ScopedModelProvider(platform)
    with pytest.raises(PlatformBudgetError, match="BYOK_BUDGET_REQUIRED"):
        await getattr(provider, operation)(selection(), "test", max_output_tokens=10)
    resolver.assert_not_awaited()
    assert platform.mock_calls == []


async def test_personal_failures_do_not_open_platform_circuit() -> None:
    provider = AsyncMock()
    provider.generate_structured.side_effect = ProviderCallError("personal failure")
    gateway = AIGateway(provider, policy=GatewayPolicy(circuit_failure_threshold=1))
    with pytest.raises(ProviderCallError):
        await gateway.generate_structured(selection(), "test", max_output_tokens=10)
    provider.generate_structured.side_effect = None
    provider.generate_structured.return_value = ModelGeneration(
        payload={}, input_tokens=0, output_tokens=0, model_calls=1
    )
    await gateway.generate_structured(
        ModelSelection(provider=Provider.OPENAI, model="test-model"), "test", max_output_tokens=10
    )
    assert provider.generate_structured.await_count == 2
