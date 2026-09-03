"""Recovery uses durable text and fresh, scope-bound authorization without restarting attempts."""

# ruff: noqa: E501, I001

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.research_recovery.router import router
from contracts import AgentInput, AgentRunRequest, AgentRunStatus, DepartmentName, ModelSelection, Provider, RunBudget, SafetyContextInput, TrustedRunContext
from runtime.research_dispatch import InMemoryResearchDispatchContextBroker
from runtime.research_input import research_input_digest
from runtime.research_recovery import ResearchRecoveryRequest, ResearchRecoveryService
from runtime.scheduler import WorkerCapacitySnapshot
from runtime.task_contracts import AttemptStatus, DepartmentTask, ExecutionRoute, TaskAttempt, TaskExecutionSnapshot, TaskStatus
from runtime.task_guard import TaskGuardRejection
from security import DelegationTokenVerifier, TokenVerificationError


@pytest.fixture
def setup():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    verifier = DelegationTokenVerifier(public_key=public, issuer="spring", audience="agent", leeway_seconds=0)
    context = TrustedRunContext(run_id=uuid4(), thread_id=uuid4(), trace_id="recovery-test", workspace_id=uuid4(), project_id=uuid4(), initiated_by=uuid4(), effective_permissions=["agent.run", "project.read"])
    budget = RunBudget(max_duration_seconds=60, max_model_calls=2, max_tool_calls=2, max_input_tokens=1000, max_output_tokens=1000, max_departments=1, max_hierarchy_depth=1)
    request = AgentRunRequest(context=context, budget=budget, model_selection=ModelSelection(provider=Provider.OPENAI, model="gpt-test"), safety_context=SafetyContextInput(), input=AgentInput(requirement_text="durable private objective", jurisdiction_code="KR"))
    execution = TaskExecutionSnapshot(route=ExecutionRoute.REACT_AGENT, permissions=context.effective_permissions, budget=budget, model_selection=request.model_selection, policy_version="task-guard-v1", prompt_version="research-v1", tool_schema_version="web-research-v1", specialist_profile="research-read-v1", authorization_revision=3, budget_revision=1, input_sha256=research_input_digest(request))
    task = DepartmentTask(task_id=uuid4(), run_id=context.run_id, workspace_id=context.workspace_id, project_id=context.project_id, department=DepartmentName.RESEARCH, revision=1, status=TaskStatus.QUEUED, execution=execution, created_at=datetime.now(UTC))
    attempt = TaskAttempt(attempt_id=uuid4(), task_id=task.task_id, run_id=task.run_id, workspace_id=task.workspace_id, task_revision=1, attempt_number=1, status=AttemptStatus.QUEUED)
    runs = SimpleNamespace(get_request=AsyncMock(return_value=request), get=AsyncMock(return_value=SimpleNamespace(status=AgentRunStatus.RUNNING)))
    registry = SimpleNamespace(get_task=AsyncMock(return_value=task), get_attempt=AsyncMock(return_value=attempt))
    dispatcher = SimpleNamespace(observe_queued=AsyncMock(), capacity=lambda now: WorkerCapacitySnapshot("research-read-v1", 1, now))
    publisher = SimpleNamespace(publish_once=AsyncMock(return_value=2))
    broker = InMemoryResearchDispatchContextBroker(verifier)
    service = ResearchRecoveryService(runs, registry, broker, dispatcher, publisher, verifier, [task.workspace_id])
    body = ResearchRecoveryRequest(task_id=task.task_id, task_revision=1, attempt_id=attempt.attempt_id, authorization_revision=3, budget_revision=1)
    claim = SimpleNamespace(candidate=SimpleNamespace(attempt_id=attempt.attempt_id))

    def token(**changes):
        now = datetime.now(UTC)
        claims = {"iss": "spring", "aud": "agent", "sub": str(context.initiated_by), "jti": str(uuid4()), "iat": now, "exp": now + timedelta(seconds=60), "run_id": str(context.run_id), "workspace_id": str(context.workspace_id), "project_id": str(context.project_id), "initiated_by": str(context.initiated_by), "permissions": ["agent.run", "project.read", "agent.task.recover"]}
        claims.update(changes)
        return jwt.encode(claims, key, algorithm="RS256")

    return SimpleNamespace(**locals())


async def test_restores_from_empty_broker_and_replays_only_its_run(setup):
    s = setup
    first = await s.service.restore(s.context.run_id, s.body, s.token())
    fresh_token = s.token()
    second = await s.service.restore(s.context.run_id, s.body, fresh_token)
    loaded = await s.broker.load(s.claim)
    assert first.status == second.status == "STAGED"
    assert loaded.objective == s.request.input.requirement_text
    assert loaded.jurisdiction == "KR"
    assert loaded.workload_token == fresh_token
    assert fresh_token not in repr(loaded)
    s.publisher.publish_once.assert_awaited_with(fresh_token, workspace_id=s.context.workspace_id, run_id=s.context.run_id)
    assert "objective" not in s.body.model_dump_json() and "token" not in s.body.model_dump_json()


@pytest.mark.parametrize("field", ["run_id", "workspace_id", "project_id", "initiated_by"])
async def test_rejects_cross_scope_before_staging_or_publishing(setup, field):
    s = setup
    changes = {field: str(uuid4())}
    if field == "initiated_by":
        changes["sub"] = changes[field]
    with pytest.raises(TokenVerificationError):
        await s.service.restore(s.context.run_id, s.body, s.token(**changes))
    s.dispatcher.observe_queued.assert_not_awaited()
    s.publisher.publish_once.assert_not_awaited()


@pytest.mark.parametrize("permissions", [["agent.run", "project.read"], ["agent.run", "agent.task.recover"]])
async def test_requires_recovery_capability_and_task_permissions(setup, permissions):
    s = setup
    with pytest.raises((TokenVerificationError, TaskGuardRejection)):
        await s.service.restore(s.context.run_id, s.body, s.token(permissions=permissions))
    s.publisher.publish_once.assert_not_awaited()


async def test_rejects_expired_signed_token(setup):
    s = setup
    with pytest.raises(TokenVerificationError):
        await s.service.restore(s.context.run_id, s.body, s.token(exp=datetime.now(UTC) - timedelta(seconds=1)))
    s.runs.get_request.assert_not_awaited()


@pytest.mark.parametrize("field", ["authorization_revision", "budget_revision"])
async def test_rejects_stale_revalidation_revisions(setup, field):
    s = setup
    with pytest.raises(TaskGuardRejection):
        await s.service.restore(s.context.run_id, s.body.model_copy(update={field: 99}), s.token())
    s.publisher.publish_once.assert_not_awaited()


@pytest.mark.parametrize("status", [AttemptStatus.RUNNING, AttemptStatus.COMPLETED, AttemptStatus.FAILED, AttemptStatus.CANCELLED, AttemptStatus.SUPERSEDED])
async def test_never_restarts_a_started_or_terminal_attempt(setup, status):
    s = setup
    s.registry.get_attempt.return_value = s.attempt.model_copy(update={"status": status})
    result = await s.service.restore(s.context.run_id, s.body, s.token())
    assert result.status == "REPLAY_ONLY"
    s.dispatcher.observe_queued.assert_not_awaited()
    assert await s.broker.load(s.claim) is None
    s.publisher.publish_once.assert_awaited_once()


@pytest.mark.parametrize("status", [AgentRunStatus.CANCELLED, AgentRunStatus.FAILED])
async def test_cancelled_or_failed_parent_permits_replay_not_staging(setup, status):
    s = setup
    s.runs.get.return_value = SimpleNamespace(status=status)
    assert (await s.service.restore(s.context.run_id, s.body, s.token())).status == "REPLAY_ONLY"
    s.dispatcher.observe_queued.assert_not_awaited()


async def test_changed_durable_input_requires_readmission(setup):
    s = setup
    s.runs.get_request.return_value = s.request.model_copy(update={"input": AgentInput(requirement_text="changed during resume")})
    with pytest.raises(ValueError, match="input reference"):
        await s.service.restore(s.context.run_id, s.body, s.token())
    s.dispatcher.observe_queued.assert_not_awaited()


async def test_legacy_task_without_input_hash_is_not_rehydrated(setup):
    s = setup
    s.registry.get_task.return_value = s.task.model_copy(update={"execution": s.execution.model_copy(update={"input_sha256": None})})
    with pytest.raises(ValueError, match="input reference"):
        await s.service.restore(s.context.run_id, s.body, s.token())


async def test_broker_rechecks_token_at_dispatch_without_sleep(setup, monkeypatch):
    s = setup
    await s.service.restore(s.context.run_id, s.body, s.token())

    def expired(token):
        raise TokenVerificationError("expired")

    monkeypatch.setattr(s.verifier, "verify", expired)
    assert await s.broker.load(s.claim) is None
    assert not s.broker._contexts


def test_http_contract_requires_recovery_capability_and_hides_reference_errors(setup):
    s = setup
    app = FastAPI()
    app.state.delegation_token_verifier = s.verifier
    app.state.research_recovery_service = s.service
    app.include_router(router)
    url = f"/internal/v1/agent-runs/{s.context.run_id}/research-recovery"
    with TestClient(app) as client:
        assert client.post(url, json=s.body.model_dump(mode="json")).status_code == 401
        assert client.post(url, json=s.body.model_dump(mode="json"), headers={"Authorization": f"Bearer {s.token(permissions=['agent.run', 'project.read'])}"}).status_code == 403
        response = client.post(url, json=s.body.model_dump(mode="json"), headers={"Authorization": f"Bearer {s.token()}"})
        assert response.status_code == 200
        assert response.json()["status"] == "STAGED"
        assert s.request.input.requirement_text not in response.text
        app.state.research_recovery_service = None
        assert client.post(url, json=s.body.model_dump(mode="json"), headers={"Authorization": f"Bearer {s.token()}"}).status_code == 503


async def test_report_only_token_drains_events_but_cannot_restore_execution(setup):
    s = setup
    await s.service.restore(s.context.run_id, s.body, s.token())
    s.dispatcher.observe_queued.reset_mock()
    token = s.token(permissions=["agent.task.report"])
    assert (await s.service.replay(s.context.run_id, s.body, token)).status == "REPLAY_ONLY"
    s.dispatcher.observe_queued.assert_not_awaited()
    assert await s.broker.load(s.claim) is None
    with pytest.raises(TokenVerificationError):
        await s.service.restore(s.context.run_id, s.body, token)


async def test_report_only_scope_is_checked_before_outbox_claim(setup):
    s = setup
    with pytest.raises(TokenVerificationError):
        await s.service.replay(s.context.run_id, s.body, s.token(permissions=["agent.task.report"], project_id=str(uuid4())))
    s.publisher.publish_once.assert_not_awaited()
