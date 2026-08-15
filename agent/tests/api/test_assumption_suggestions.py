from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from contracts import AgentRunRequest, AgentRunResult, ModelSelection
from gateway import AIGateway, GatewayPolicy
from main import create_app
from providers import ModelGeneration
from runtime import ExecutionAuthorization, ExecutionOutcome, InMemoryAgentRunStore, RunCoordinator
from security import DelegationTokenVerifier


class IdleExecutor:
    async def execute(self, request: AgentRunRequest, resume: object | None = None, authorization: ExecutionAuthorization | None = None) -> ExecutionOutcome:  # noqa: E501
        del request, resume, authorization
        return ExecutionOutcome(result=AgentRunResult(project_summary="unused"))


class AssumptionProvider:
    def __init__(self) -> None:
        self.prompt = ""

    async def generate_structured(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        raise AssertionError("structured generation is not expected")

    async def generate_react_step(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        raise AssertionError("ReAct generation is not expected")

    async def generate_assumption(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
        del selection, max_output_tokens, max_attempts
        self.prompt = prompt
        return ModelGeneration(
            payload={"content": "회원 데이터 이전 범위는 기존 계정 1천 건 이내로 가정하며 저장 전 확인이 필요합니다."},
            input_tokens=31,
            output_tokens=18
        )


def _client(permissions: list[str] | None = None) -> tuple[TestClient, str, dict[str, object], AssumptionProvider]:
    run_id = uuid4()
    workspace_id = uuid4()
    project_id = uuid4()
    user_id = uuid4()
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    verifier = DelegationTokenVerifier(
        public_key=public_pem,
        issuer="freelance-ops-backend",
        audience="freelance-ops-agent"
    )
    now = datetime.now(UTC)
    effective_permissions = permissions or ["agent.run", "quotation.write"]
    token = jwt.encode(
        {
            "iss": "freelance-ops-backend",
            "aud": "freelance-ops-agent",
            "sub": str(user_id),
            "jti": str(uuid4()),
            "iat": now,
            "exp": now + timedelta(minutes=2),
            "run_id": str(run_id),
            "workspace_id": str(workspace_id),
            "project_id": str(project_id),
            "initiated_by": str(user_id),
            "permissions": effective_permissions
        },
        private_key,
        algorithm="RS256"
    )
    body: dict[str, object] = {
        "context": {
            "runId": str(run_id),
            "threadId": str(uuid4()),
            "traceId": "trace-assumption",
            "workspaceId": str(workspace_id),
            "projectId": str(project_id),
            "initiatedBy": str(user_id),
            "effectivePermissions": effective_permissions
        },
        "modelSelection": {"provider": "OPENAI", "model": "gpt-test", "reasoningEffort": "LOW"},
        "projectRequirement": "회원 가입 시스템을 구축합니다.",
        "itemTitle": "회원 데이터 이전",
        "itemDescription": "기존 회원을 신규 시스템으로 이전합니다.",
        "quantity": 1,
        "unit": "건",
        "currentAssumption": ""
    }
    app = create_app(
        run_coordinator=RunCoordinator(InMemoryAgentRunStore(), IdleExecutor()),
        delegation_token_verifier=verifier
    )
    provider = AssumptionProvider()
    app.state.ai_gateway = AIGateway(provider, policy=GatewayPolicy())
    return TestClient(app), token, body, provider


def test_suggests_reviewable_assumption_with_selected_model() -> None:
    client, token, body, provider = _client()

    response = client.post(
        "/internal/v1/quotation-assumptions/suggest",
        headers={"Authorization": f"Bearer {token}"},
        json=body
    )

    assert response.status_code == 200
    assert response.json()["provider"] == "OPENAI"
    assert response.json()["model"] == "gpt-test"
    assert response.json()["usage"]["modelCalls"] == 1
    assert "회원 데이터 이전" in provider.prompt


def test_rejects_suggestion_without_quotation_permission() -> None:
    client, token, body, _ = _client(["agent.run"])

    response = client.post(
        "/internal/v1/quotation-assumptions/suggest",
        headers={"Authorization": f"Bearer {token}"},
        json=body
    )

    assert response.status_code == 403
