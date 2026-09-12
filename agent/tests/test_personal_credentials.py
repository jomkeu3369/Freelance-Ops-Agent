from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest

import personal_credentials
import providers
from contracts import ModelSelection, Provider
from gateway import AIGateway, GatewayPolicy
from personal_credentials import credential_scope, resolve_credential
from providers import CompositeModelProvider, ModelGeneration, ProviderCallError


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
    monkeypatch.setattr(personal_credentials.httpx, "AsyncClient", lambda **kwargs: original(
        **kwargs, transport=httpx.MockTransport(respond)
    ))
    with credential_scope("delegated-test", run_id):
        assert await resolve_credential(chosen, "http://backend:8080", 1) == "synthetic-key"
    with pytest.raises(ValueError, match="authorization unavailable"):
        await resolve_credential(chosen, "http://backend:8080", 1)
    assert len(requests) == 1
    assert "synthetic-key" not in str(requests[0].url)


async def test_deleted_connection_fails_without_platform_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    platform = AsyncMock()
    monkeypatch.setattr(providers, "resolve_credential", AsyncMock(side_effect=ValueError("secret-provider-detail")))
    composite = CompositeModelProvider(platform, platform)
    with pytest.raises(ProviderCallError, match="Personal AI connection unavailable") as caught:
        await composite.generate_structured(selection(), "test", max_output_tokens=10)
    assert caught.value.__suppress_context__
    platform.generate_structured.assert_not_awaited()


async def test_personal_calls_use_fresh_clients_and_preserve_usage(monkeypatch: pytest.MonkeyPatch) -> None:
    import openai

    keys = []
    clients = []
    resolver = AsyncMock(side_effect=["synthetic-first", "synthetic-replacement"])
    monkeypatch.setattr(providers, "resolve_credential", resolver)

    def client(**kwargs: object) -> AsyncMock:
        keys.append(kwargs["api_key"])
        instance = AsyncMock()
        clients.append(instance)
        return instance

    monkeypatch.setattr(openai, "AsyncOpenAI", client)
    monkeypatch.setattr(providers.OpenAIModelProvider, "generate_assumption", AsyncMock(
        return_value=ModelGeneration(payload={"content": "test"}, input_tokens=2, output_tokens=3, model_calls=1)
    ))
    composite = CompositeModelProvider(AsyncMock(), AsyncMock())
    for _ in range(2):
        result = await composite.generate_assumption(selection(), "test", max_output_tokens=10)
        assert result.input_tokens == 2
    assert keys == ["synthetic-first", "synthetic-replacement"]
    for instance in clients:
        instance.close.assert_awaited_once()


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


async def test_gemini_personal_client_closes_without_using_platform_key(monkeypatch: pytest.MonkeyPatch) -> None:
    from types import SimpleNamespace

    from google import genai

    client = AsyncMock()
    keys = []

    def create_client(**kwargs: object) -> SimpleNamespace:
        keys.append(kwargs["api_key"])
        assert kwargs["vertexai"] is False
        return SimpleNamespace(aio=client)

    monkeypatch.setattr(genai, "Client", create_client)
    monkeypatch.setattr(providers, "resolve_credential", AsyncMock(return_value="synthetic-gemini-key"))
    monkeypatch.setattr(providers.GeminiModelProvider, "generate_assumption", AsyncMock(
        return_value=ModelGeneration(payload={"content": "test"}, input_tokens=2, output_tokens=3, model_calls=1)
    ))
    platform = AsyncMock()
    composite = CompositeModelProvider(platform, platform)
    await composite.generate_assumption(
        ModelSelection(provider=Provider.GEMINI, model="gemini-2.5-flash", credential_id=uuid4()),
        "test", max_output_tokens=10
    )
    assert keys == ["synthetic-gemini-key"]
    client.aclose.assert_awaited_once()
    platform.generate_assumption.assert_not_awaited()
