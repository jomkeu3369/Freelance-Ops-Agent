from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from contracts import (
    AgentInput,
    AgentInterruption,
    AgentRunRequest,
    AgentRunResult,
    AgentWorkflowMode,
    InterruptionKind,
    ModelSelection,
    Provider,
    RaptorBuildRequest,
    RaptorBuildResponse,
    ResumeAgentRunRequest,
    RunBudget,
    SafetyContextInput,
    TrustedRunContext,
)
from main import create_app
from providers import ModelGeneration
from routing import FinalRouteDecision, RouteDecisionSource, RouteLabel
from runtime import (
    AgentRunExecutor,
    ExecutionAuthorization,
    ExecutionEvent,
    ExecutionOutcome,
    InMemoryAgentRunStore,
    OperationalAgentExecutor,
    RunCoordinator,
)
from security import DelegationTokenVerifier


class SuccessfulExecutor:
    async def execute(
        self,
        request: AgentRunRequest,
        resume: ResumeAgentRunRequest | None = None,
        authorization: ExecutionAuthorization | None = None,
    ) -> ExecutionOutcome:
        del request, resume, authorization
        return ExecutionOutcome(result=AgentRunResult(project_summary="completed"))


class RoutedExecutor:
    async def execute(self, request: AgentRunRequest, resume: ResumeAgentRunRequest | None = None, authorization: ExecutionAuthorization | None = None) -> ExecutionOutcome:  # noqa: E501
        del request, resume, authorization
        return ExecutionOutcome(
            result=AgentRunResult(project_summary="completed"),
            events=(ExecutionEvent("route.selected", {
                "route": "SIMPLE_LLM",
                "decisionSource": "LLM_EVALUATOR",
                "routingLatencyMs": 120.0,
                "routingInputTokens": 100,
                "routingOutputTokens": 10
            }),)
        )


class InterruptThenCompleteExecutor:
    async def execute(
        self,
        request: AgentRunRequest,
        resume: ResumeAgentRunRequest | None = None,
        authorization: ExecutionAuthorization | None = None,
    ) -> ExecutionOutcome:
        del request, authorization
        if resume is None:
            return ExecutionOutcome(
                interruption=AgentInterruption(
                    interruption_id=UUID("00000000-0000-0000-0000-000000000123"),
                    kind=InterruptionKind.CLARIFICATION,
                    questions=["납기일은 언제인가요?"],
                )
            )
        return ExecutionOutcome(result=AgentRunResult(project_summary="resumed"))


class RecordingRaptorService:
    def __init__(self) -> None:
        self.request: RaptorBuildRequest | None = None

    async def build(self, request: RaptorBuildRequest) -> RaptorBuildResponse:
        self.request = request
        return RaptorBuildResponse(
            workspace_id=request.context.workspace_id,
            snapshot_id=request.context.snapshot_id,
            embedding_model=request.embedding_model,
            summary_model=request.summary_model,
            nodes=[],
            root_ids=[],
        )


def _request(run_id: UUID, workspace_id: UUID, project_id: UUID, user_id: UUID) -> AgentRunRequest:
    return AgentRunRequest(
        context=TrustedRunContext(
            run_id=run_id,
            thread_id=uuid4(),
            trace_id="trace-1",
            workspace_id=workspace_id,
            project_id=project_id,
            initiated_by=user_id,
            effective_permissions=["agent.run"],
        ),
        budget=RunBudget(
            max_duration_seconds=30,
            max_model_calls=3,
            max_tool_calls=0,
            max_input_tokens=1000,
            max_output_tokens=1000,
            max_departments=1,
            max_hierarchy_depth=1,
        ),
        model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-5.4-mini"),
        safety_context=SafetyContextInput(),
        input=AgentInput(requirement_text="요구사항을 정리해 주세요."),
    )


def _client_and_token(
    request: AgentRunRequest,
    executor: AgentRunExecutor | None = None,
    raptor_service: RecordingRaptorService | None = None,
) -> tuple[TestClient, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    verifier = DelegationTokenVerifier(
        public_key=public_pem,
        issuer="freelance-ops-backend",
        audience="freelance-ops-agent",
    )
    now = datetime.now(UTC)
    context = request.context
    token = jwt.encode(
        {
            "iss": "freelance-ops-backend",
            "aud": "freelance-ops-agent",
            "sub": str(context.initiated_by),
            "jti": str(uuid4()),
            "iat": now,
            "exp": now + timedelta(minutes=2),
            "run_id": str(context.run_id),
            "workspace_id": str(context.workspace_id),
            "project_id": str(context.project_id),
            "initiated_by": str(context.initiated_by),
            "permissions": ["agent.run", "agent.respond", "agent.cancel", "project.read", "knowledge.index"],
        },
        private_key,
        algorithm="RS256",
    )
    coordinator = RunCoordinator(InMemoryAgentRunStore(), executor or SuccessfulExecutor())
    return (
        TestClient(
            create_app(
                run_coordinator=coordinator,
                delegation_token_verifier=verifier,
                raptor_build_service=raptor_service,
            )
        ),
        token,
    )


def test_start_and_read_completed_agent_run() -> None:
    request = _request(uuid4(), uuid4(), uuid4(), uuid4())
    client, token = _client_and_token(request)
    headers = {"Authorization": f"Bearer {token}"}

    start = client.post(
        "/internal/v1/agent-runs",
        headers=headers,
        json=request.model_dump(mode="json", by_alias=True),
    )
    view = client.get(f"/internal/v1/agent-runs/{request.context.run_id}", headers=headers)

    assert start.status_code == 202
    assert start.json()["runId"] == str(request.context.run_id)
    assert view.status_code == 200
    assert view.json()["status"] == "COMPLETED"
    assert view.json()["result"]["projectSummary"] == "completed"
    assert view.json()["metadata"] == {
        "provider": "OPENAI",
        "model": "gpt-5.4-mini",
        "promptVersion": "department-work-product-v1",
        "toolSchemaVersion": "spring-tool-api-v0.2.0",
        "traceId": "trace-1",
    }


def test_start_requires_delegation_token() -> None:
    request = _request(uuid4(), uuid4(), uuid4(), uuid4())
    client, _ = _client_and_token(request)

    response = client.post(
        "/internal/v1/agent-runs",
        json=request.model_dump(mode="json", by_alias=True),
    )

    assert response.status_code == 401
    assert response.json()["code"] == "DELEGATION_TOKEN_REQUIRED"


def test_start_rejects_context_outside_token_scope() -> None:
    request = _request(uuid4(), uuid4(), uuid4(), uuid4())
    client, token = _client_and_token(request)
    body = request.model_dump(mode="json", by_alias=True)
    body["context"]["workspaceId"] = str(uuid4())

    response = client.post(
        "/internal/v1/agent-runs",
        headers={"Authorization": f"Bearer {token}"},
        json=body,
    )

    assert response.status_code == 403
    assert response.json()["code"] == "RUN_CONTEXT_FORBIDDEN"


def test_interrupted_run_can_resume_once() -> None:
    request = _request(uuid4(), uuid4(), uuid4(), uuid4())
    client, token = _client_and_token(request, InterruptThenCompleteExecutor())
    headers = {"Authorization": f"Bearer {token}"}
    client.post(
        "/internal/v1/agent-runs",
        headers=headers,
        json=request.model_dump(mode="json", by_alias=True),
    )
    waiting = client.get(f"/internal/v1/agent-runs/{request.context.run_id}", headers=headers)
    interruption_id = waiting.json()["interruption"]["interruptionId"]

    resumed = client.post(
        f"/internal/v1/agent-runs/{request.context.run_id}/resume",
        headers=headers,
        json={
            "interruptionId": interruption_id,
            "idempotencyKey": "resume-key-0001",
            "answers": [{"questionIndex": 0, "answer": "2026-09-30"}],
        },
    )
    completed = client.get(f"/internal/v1/agent-runs/{request.context.run_id}", headers=headers)

    assert resumed.status_code == 202
    assert waiting.json()["status"] == "WAITING_FOR_USER"
    assert completed.json()["status"] == "COMPLETED"
    assert completed.json()["result"]["projectSummary"] == "resumed"


def test_completed_run_exposes_ordered_server_sent_events() -> None:
    request = _request(uuid4(), uuid4(), uuid4(), uuid4())
    client, token = _client_and_token(request)
    headers = {"Authorization": f"Bearer {token}"}
    client.post(
        "/internal/v1/agent-runs",
        headers=headers,
        json=request.model_dump(mode="json", by_alias=True),
    )

    response = client.get(f"/internal/v1/agent-runs/{request.context.run_id}/events", headers=headers)

    assert response.status_code == 200
    assert "event: run.accepted" in response.text
    assert "event: run.started" in response.text
    assert "event: run.completed" in response.text


def test_route_observation_snapshot_is_finite_scoped_and_cursor_based() -> None:
    request = _request(uuid4(), uuid4(), uuid4(), uuid4())
    client, token = _client_and_token(request, RoutedExecutor())
    headers = {"Authorization": f"Bearer {token}"}
    client.post(
        "/internal/v1/agent-runs",
        headers=headers,
        json=request.model_dump(mode="json", by_alias=True)
    )

    first = client.get(f"/internal/v1/agent-runs/{request.context.run_id}/route-observations", headers=headers)
    cursor = first.json()["nextEventId"]
    second = client.get(
        f"/internal/v1/agent-runs/{request.context.run_id}/route-observations",
        headers={**headers, "After-Event-ID": str(cursor)}
    )

    assert first.status_code == 200
    assert first.json()["terminal"] is True
    assert first.json()["hasMore"] is False
    assert len(first.json()["events"]) == 1
    assert first.json()["events"][0]["data"]["route"] == "SIMPLE_LLM"
    assert second.json()["events"] == []
    assert second.json()["nextEventId"] == cursor


def test_route_observation_snapshot_rejects_another_run_scope() -> None:
    request = _request(uuid4(), uuid4(), uuid4(), uuid4())
    client, token = _client_and_token(request, RoutedExecutor())

    response = client.get(
        f"/internal/v1/agent-runs/{uuid4()}/route-observations",
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 403
    assert response.json()["code"] == "DELEGATION_FORBIDDEN"


def test_waiting_run_can_be_cancelled() -> None:
    request = _request(uuid4(), uuid4(), uuid4(), uuid4())
    client, token = _client_and_token(request, InterruptThenCompleteExecutor())
    headers = {"Authorization": f"Bearer {token}"}
    client.post(
        "/internal/v1/agent-runs",
        headers=headers,
        json=request.model_dump(mode="json", by_alias=True),
    )

    response = client.post(f"/internal/v1/agent-runs/{request.context.run_id}/cancel", headers=headers)

    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"


def test_http_vertical_slice_routes_calls_spring_tool_and_generates_result() -> None:
    request = _request(uuid4(), uuid4(), uuid4(), uuid4())
    request.input.workflow_mode = AgentWorkflowMode.AD_HOC
    request.budget.max_tool_calls = 1
    request.budget.max_model_calls = 3
    request.budget.max_departments = 2
    request.context.effective_permissions.append("project.read")

    class Gateway:
        async def route(self, text: str, safety_context: object = None) -> FinalRouteDecision:
            del text, safety_context
            return FinalRouteDecision(
                route=RouteLabel.REACT_AGENT,
                source=RouteDecisionSource.LLM_EVALUATOR,
                local_decision=None,
            )

    class ProviderAdapter:
        async def generate_structured(self, selection: ModelSelection, prompt: str, *, max_output_tokens: int, max_attempts: int | None = None) -> ModelGeneration:  # noqa: E501
            del selection, prompt, max_output_tokens, max_attempts
            return ModelGeneration(payload={"summary": "검증된 부서 결과", "open_questions": []})

    class ProjectTool:
        token: str | None = None

        async def get_project_context(self, delegation_token: str, *, run_id: UUID, project_id: UUID, max_attempts: int | None = None, traceparent: str | None = None) -> object:  # noqa: E501
            from contracts import ProjectContext

            del run_id, max_attempts, traceparent
            self.token = delegation_token
            return ProjectContext(
                project_id=project_id,
                workspace_id=request.context.workspace_id,
                title="통합 테스트 프로젝트",
                requirement_text="검증된 요구사항",
                currency="KRW",
            )

    tool = ProjectTool()
    executor = OperationalAgentExecutor(Gateway(), ProviderAdapter(), tool)  # type: ignore[arg-type]
    client, token = _client_and_token(request, executor)
    headers = {"Authorization": f"Bearer {token}"}

    started = client.post(
        "/internal/v1/agent-runs",
        headers=headers,
        json=request.model_dump(mode="json", by_alias=True),
    )
    view = client.get(f"/internal/v1/agent-runs/{request.context.run_id}", headers=headers)
    events = client.get(f"/internal/v1/agent-runs/{request.context.run_id}/events", headers=headers)

    assert started.status_code == 202
    assert view.json()["status"] == "COMPLETED"
    assert len(view.json()["result"]["departmentResults"]) == 2
    assert "run.completed" in events.text
    assert tool.token == token


def test_raptor_build_is_scoped_to_delegated_workspace() -> None:
    request = _request(uuid4(), uuid4(), uuid4(), uuid4())
    service = RecordingRaptorService()
    client, token = _client_and_token(request, raptor_service=service)
    snapshot_id = uuid4()

    response = client.post(
        "/internal/v1/raptor/build",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "context": {
                "runId": str(request.context.run_id),
                "workspaceId": str(request.context.workspace_id),
                "projectId": str(request.context.project_id),
                "snapshotId": str(snapshot_id),
            },
            "provider": "OPENAI",
            "embeddingModel": "text-embedding-3-small",
            "summaryModel": "gpt-5.4-mini",
            "chunks": [
                {
                    "chunkId": str(uuid4()),
                    "documentId": str(uuid4()),
                    "text": "검증 가능한 원문 청크",
                    "metadata": {"page": "1"},
                }
            ],
        },
    )

    assert response.status_code == 200
    assert response.json()["snapshotId"] == str(snapshot_id)
    assert service.request is not None
