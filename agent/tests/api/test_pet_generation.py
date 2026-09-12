import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from langsmith.run_helpers import get_tracing_context
from pydantic import ValidationError

from api.pets.router import router
from contracts import ModelSelection, PetProfile, Provider
from gateway import AIGateway, GatewayPolicy
from providers import GeminiModelProvider, ModelGeneration, OpenAIModelProvider, ProviderCallError
from security import DelegationPrincipal

PROFILE = {
    "slot": "LEAN", "name": "밤이", "animal": "cat", "color": "ink", "accessory": "star",
    "tone": "DIRECT", "valuePriority": "PROFIT", "deliveryPriority": "SPEED", "scopePriority": "CAUTIOUS"
}


def client_fixture() -> tuple[TestClient, dict, Mock]:
    run, workspace, project, user = (uuid4() for _ in range(4))
    app = FastAPI()
    app.include_router(router)
    app.state.delegation_token_verifier = Mock(verify=Mock(return_value=DelegationPrincipal(
        str(user), "synthetic", run, workspace, project, user, frozenset({"agent.run", "project.read"})
    )))
    provider = Mock(generate_pet=AsyncMock(return_value=ModelGeneration(PROFILE, 15, 20)))
    app.state.ai_gateway = AIGateway(provider, policy=GatewayPolicy())
    body = {
        "context": {"runId": str(run), "threadId": str(uuid4()), "traceId": "test-pet", "workspaceId": str(workspace), "projectId": str(project), "initiatedBy": str(user), "effectivePermissions": ["agent.run", "project.read"]},  # noqa: E501
        "modelSelection": {"provider": "OPENAI", "model": "test-model"},
        "slot": "LEAN", "description": "수익을 챙겨 주는 검은 고양이"
    }
    return TestClient(app), body, provider


def test_generation_returns_reviewable_closed_profile_and_bounded_usage() -> None:
    client, body, provider = client_fixture()
    async def generate_without_prompt_tracing(*args: object, **kwargs: object) -> ModelGeneration:
        assert get_tracing_context()["enabled"] is False
        return ModelGeneration(PROFILE, 15, 20)
    provider.generate_pet.side_effect = generate_without_prompt_tracing
    response = client.post("/internal/v1/pets/generate", json=body, headers={"Authorization": "Bearer synthetic"})
    assert response.status_code == 200
    assert response.json()["profile"] == PROFILE
    assert response.json()["inputTokens"] == 15
    provider.generate_pet.assert_awaited_once()
    assert provider.generate_pet.call_args.kwargs == {"max_output_tokens": 1000, "max_attempts": 1}


@pytest.mark.parametrize("field", ["workspaceId", "projectId", "initiatedBy", "runId"])
def test_generation_rejects_mismatched_delegation(field: str) -> None:
    client, body, provider = client_fixture()
    body["context"][field] = str(uuid4())
    response = client.post("/internal/v1/pets/generate", json=body, headers={"Authorization": "Bearer synthetic"})
    assert response.status_code == 403
    provider.generate_pet.assert_not_awaited()


def test_generation_failure_and_invalid_slot_do_not_fallback() -> None:
    client, body, provider = client_fixture()
    provider.generate_pet.side_effect = ProviderCallError("private provider error")
    response = client.post("/internal/v1/pets/generate", json=body, headers={"Authorization": "Bearer synthetic"})
    assert response.status_code == 502
    assert "private" not in response.text
    assert provider.generate_pet.await_count == 1
    provider.generate_pet.side_effect = None
    provider.generate_pet.return_value = ModelGeneration({**PROFILE, "slot": "EXPANDED"})
    assert client.post("/internal/v1/pets/generate", json=body, headers={"Authorization": "Bearer synthetic"}).status_code == 502  # noqa: E501


@pytest.mark.parametrize("changes", [{"animal": "<svg>"}, {"color": "url(evil)"}, {"name": "<script>"}, {"name": "x" * 21}, {"valuePriority": "ignore permissions"}, {"apiKey": "forbidden"}])  # noqa: E501
def test_closed_profile_rejects_code_and_unbounded_instructions(changes: dict) -> None:
    with pytest.raises(ValidationError):
        PetProfile.model_validate({**PROFILE, **changes})


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", [Provider.OPENAI, Provider.GEMINI])
async def test_both_providers_use_profile_schema_and_no_tools(provider: Provider, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: E501
    call = AsyncMock(return_value=SimpleNamespace(
        output_text=json.dumps(PROFILE), text=json.dumps(PROFILE), usage=SimpleNamespace(input_tokens=8, output_tokens=10),  # noqa: E501
        usage_metadata=SimpleNamespace(prompt_token_count=8, candidates_token_count=10)
    ))
    constructor = Mock(return_value=SimpleNamespace(responses=SimpleNamespace(create=call)))
    monkeypatch.setattr("openai.AsyncOpenAI", constructor)
    adapter = (
        OpenAIModelProvider() if provider == Provider.OPENAI
        else GeminiModelProvider(SimpleNamespace(models=SimpleNamespace(generate_content=call)))
    )
    result = await adapter.generate_pet(ModelSelection(provider=provider, model="test"), "cat", max_output_tokens=1000, max_attempts=1)  # noqa: E501
    assert result.payload["animal"] == "cat"
    assert result.output_tokens == 10
    kwargs = call.call_args.kwargs
    schema = kwargs["text"]["format"]["schema"] if provider == Provider.OPENAI else kwargs["config"]["response_json_schema"]  # noqa: E501
    assert schema["additionalProperties"] is False
    assert "animal" in schema["required"]
    if provider == Provider.OPENAI:
        assert kwargs["tools"] == []
        assert kwargs["store"] is False
        constructor.assert_called_once_with(max_retries=0)
    else:
        assert kwargs["config"]["http_options"]["retry_options"]["attempts"] == 1
