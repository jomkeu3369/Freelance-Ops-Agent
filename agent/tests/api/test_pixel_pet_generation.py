"""실제 공급자 대신 합성 응답으로 위임·호출 한도·결과 보관 순서를 검증한다."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import httpx
import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from jsonschema import ValidationError as SchemaValidationError
from pydantic import ValidationError

from api.pets.pixel_generation import router
from contracts import PixelPetSprite
from gateway import AIGateway, GatewayPolicy
from platform_budget import TARIFF_VERSION
from providers import OpenAIModelProvider
from security import DelegationPrincipal

PROFILE_PATH = Path(__file__).parents[3] / "contracts/fixtures/pixel-pet-profile.json"
PROFILE = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))


def test_shared_contract_requires_artwork_for_pixel_pets_and_keeps_legacy_profiles() -> None:
    path = PROFILE_PATH.parents[1] / "openapi/agent/pets.yaml"
    schema = yaml.safe_load(path.read_text(encoding="utf-8"))
    validator = Draft202012Validator({**schema, "$ref": "#/schemas/PetProfile"})
    validator.validate(PROFILE)
    without_sprite = {key: value for key, value in PROFILE.items() if key != "sprite"}
    validator.validate({**without_sprite, "animal": "cat"})
    for invalid in [without_sprite, {**PROFILE, "sprite": None}]:
        with pytest.raises(SchemaValidationError):
            validator.validate(invalid)


def client_fixture(monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, dict, AsyncMock, list]:
    run, workspace, project, user = (uuid4() for _ in range(4))
    app = FastAPI()
    app.include_router(router)
    app.state.delegation_token_verifier = Mock(verify=Mock(return_value=DelegationPrincipal(
        str(user), "synthetic", run, workspace, project, user, frozenset({"agent.run", "project.read"})
    )))
    create = AsyncMock(return_value=SimpleNamespace(
        output_text=json.dumps(PROFILE), model="gpt-6.1-sol", service_tier="default",
        usage=SimpleNamespace(input_tokens=1000, output_tokens=500,
            input_tokens_details=SimpleNamespace(cached_tokens=0, cache_write_tokens=0))
    ))
    provider_client = SimpleNamespace(
        responses=SimpleNamespace(create=create), base_url="https://api.openai.com/v1", max_retries=0
    )
    app.state.ai_gateway = AIGateway(
        OpenAIModelProvider(client=provider_client, max_attempts=1), policy=GatewayPolicy()
    )
    callbacks = []

    class Backend:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, **kwargs):
            callbacks.append({"path": url, **kwargs})
            return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr("api.pets.pixel_generation.httpx.AsyncClient", lambda **kwargs: Backend())
    body = {
        "context": {
            "runId": str(run), "threadId": str(uuid4()), "traceId": "pixel-test", "workspaceId": str(workspace),
            "projectId": str(project), "initiatedBy": str(user), "effectivePermissions": ["agent.run", "project.read"]
        },
        "modelSelection": {"provider": "OPENAI", "model": "gpt-6.1-sol", "reasoningEffort": "LOW"},
        "description": "꼼꼼하게 실현 가능성을 판단하는 펭귄",
        "platformBudget": {
            "reservationId": str(run), "maxCostUsd": "0.10", "tariffVersion": TARIFF_VERSION,
            "validUntil": (datetime.now(UTC) + timedelta(minutes=2)).isoformat()
        },
        "budget": {
            "maxDurationSeconds": 60, "maxModelCalls": 1, "maxToolCalls": 0, "maxInputTokens": 32000,
            "maxOutputTokens": 4096, "maxDepartments": 1, "maxHierarchyDepth": 1, "maxRetries": 0
        }
    }
    return TestClient(app), body, create, callbacks


def test_records_usage_and_penguin_before_response(monkeypatch: pytest.MonkeyPatch) -> None:
    client, body, create, callbacks = client_fixture(monkeypatch)
    response = client.post("/internal/v1/pets/generate-pixel", json=body, headers={"Authorization": "Bearer synthetic"})
    assert response.status_code == 200
    assert response.json()["profile"]["sprite"]["species"] == "펭귄"
    create.assert_awaited_once()
    assert create.call_args.kwargs["tools"] == []
    assert create.call_args.kwargs["max_output_tokens"] == 4096
    assert callbacks[0]["json"]["providerCalls"][0]["usageKnown"] is False
    assert callbacks[1]["json"]["providerCalls"][0]["usageKnown"] is True
    assert callbacks[2]["path"].endswith("/complete")
    assert callbacks[2]["json"]["profile"]["animal"] == "pixel"
    assert callbacks[3]["json"]["executionClosed"] is True
    assert all(item["headers"]["X-Run-Id"] == body["context"]["runId"] for item in callbacks)


@pytest.mark.parametrize("field", ["workspaceId", "projectId", "initiatedBy", "runId"])
def test_context_mismatch_never_reaches_model(monkeypatch: pytest.MonkeyPatch, field: str) -> None:
    client, body, create, callbacks = client_fixture(monkeypatch)
    body["context"][field] = str(uuid4())
    response = client.post("/internal/v1/pets/generate-pixel", json=body, headers={"Authorization": "Bearer synthetic"})
    assert response.status_code == 403
    create.assert_not_awaited()
    assert not callbacks


@pytest.mark.parametrize("change", ["reservation", "cost", "calls", "output", "credential"])
def test_budget_binding_is_required(monkeypatch: pytest.MonkeyPatch, change: str) -> None:
    client, body, create, callbacks = client_fixture(monkeypatch)
    if change == "reservation":
        body["platformBudget"]["reservationId"] = str(uuid4())
    elif change == "cost":
        body["platformBudget"]["maxCostUsd"] = "0.11"
    elif change == "calls":
        body["budget"]["maxModelCalls"] = 2
    elif change == "output":
        body["budget"]["maxOutputTokens"] = 4097
    else:
        body["modelSelection"]["credentialId"] = str(uuid4())
    response = client.post("/internal/v1/pets/generate-pixel", json=body, headers={"Authorization": "Bearer synthetic"})
    assert response.status_code == 403
    create.assert_not_awaited()
    assert not callbacks


def test_provider_failure_is_not_retried_or_replaced_with_preset(monkeypatch: pytest.MonkeyPatch) -> None:
    client, body, create, callbacks = client_fixture(monkeypatch)
    create.side_effect = TimeoutError("private provider details")
    response = client.post("/internal/v1/pets/generate-pixel", json=body, headers={"Authorization": "Bearer synthetic"})
    assert response.status_code == 502
    assert "private provider" not in response.text
    create.assert_awaited_once()
    assert not any(item["path"].endswith("/complete") for item in callbacks)
    assert callbacks[-1]["json"]["providerCalls"][0]["usageKnown"] is False
    assert callbacks[-1]["json"]["executionClosed"] is True


@pytest.mark.parametrize(
    "field,value", [("palette", ["<script>"] * 15), ("rows", ["x" * 32] * 32), ("rows", ["." * 32] * 32)]
)
def test_pixel_contract_rejects_code_invalid_indices_and_empty_art(field: str, value: list[str]) -> None:
    sprite = {**PROFILE["sprite"], field: value}
    with pytest.raises(ValidationError):
        PixelPetSprite.model_validate(sprite)
