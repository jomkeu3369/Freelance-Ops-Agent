"""Spring-only Agent run endpoints."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import get_settings
from contracts import (
    AgentRunAccepted,
    AgentRunRequest,
    AgentRunStatus,
    AgentRunView,
    ResumeAgentRunRequest,
)
from runtime import (
    AgentRunNotFoundError,
    AgentRunStateError,
    ExecutionAuthorization,
    RunCoordinator,
)
from security import DelegationPrincipal, DelegationTokenVerifier, TokenVerificationError

router = APIRouter(prefix="/internal/v1/agent-runs", tags=["AgentRuns"])
bearer = HTTPBearer(auto_error=False)


def _problem(status: int, title: str, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        media_type="application/problem+json",
        content={
            "type": f"urn:freelance-ops:agent:{code.lower()}",
            "title": title,
            "status": status,
            "code": code,
        },
    )


def _coordinator(request: Request) -> RunCoordinator:
    return cast(RunCoordinator, request.app.state.run_coordinator)


def _verifier(request: Request) -> DelegationTokenVerifier:
    return cast(DelegationTokenVerifier, request.app.state.delegation_token_verifier)


BearerDependency = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]
VerifierDependency = Annotated[DelegationTokenVerifier, Depends(_verifier)]
CoordinatorDependency = Annotated[RunCoordinator, Depends(_coordinator)]


def _principal(credentials: BearerDependency, verifier: VerifierDependency) -> DelegationPrincipal | JSONResponse:
    if credentials is None or credentials.scheme.lower() != "bearer":
        return _problem(401, "Delegation token is required", "DELEGATION_TOKEN_REQUIRED")
    try:
        return verifier.verify(credentials.credentials)
    except TokenVerificationError:
        return _problem(401, "Delegation token is invalid", "DELEGATION_TOKEN_INVALID")


PrincipalDependency = Annotated[DelegationPrincipal | JSONResponse, Depends(_principal)]


def _authorize(principal: DelegationPrincipal | JSONResponse, *, run_id: UUID, permission: str) -> JSONResponse | None:
    if isinstance(principal, JSONResponse):
        return principal
    try:
        DelegationTokenVerifier.authorize_run(principal, run_id=run_id, permission=permission)
    except TokenVerificationError:
        return _problem(403, "Delegated permission is insufficient", "DELEGATION_FORBIDDEN")
    return None


@router.post("", response_model=AgentRunAccepted, status_code=202)
async def start_agent_run(body: AgentRunRequest, background_tasks: BackgroundTasks, request: Request, credentials: BearerDependency, principal: PrincipalDependency, coordinator: CoordinatorDependency) -> AgentRunAccepted | JSONResponse:  # noqa: E501
    # 토큰에 위임된 workspace·project·permission 범위를 요청 본문이 넘지 못하게 한다.
    authorization_error = _authorize(principal, run_id=body.context.run_id, permission="agent.run")
    if authorization_error is not None:
        return authorization_error

    assert isinstance(principal, DelegationPrincipal)
    if (
        principal.workspace_id != body.context.workspace_id
        or principal.project_id != body.context.project_id
        or principal.initiated_by != body.context.initiated_by
        or not set(body.context.effective_permissions).issubset(principal.permissions)
    ):
        return _problem(403, "Run context exceeds delegated authority", "RUN_CONTEXT_FORBIDDEN")
    try:
        accepted = await coordinator.accept(body)
    except AgentRunStateError:
        return _problem(409, "Agent run already exists", "AGENT_RUN_CONFLICT")

    assert credentials is not None
    background_tasks.add_task(
        coordinator.execute,
        body,
        ExecutionAuthorization(credentials.credentials, request.state.traceparent),
    )
    return accepted


@router.get("/{run_id}", response_model=AgentRunView)
async def get_agent_run(run_id: UUID, principal: PrincipalDependency, coordinator: CoordinatorDependency) -> AgentRunView | JSONResponse:  # noqa: E501
    authorization_error = _authorize(principal, run_id=run_id, permission="agent.run")
    if authorization_error is not None:
        return authorization_error
    try:
        return await coordinator.view(run_id)
    except AgentRunNotFoundError:
        return _problem(404, "Agent run was not found", "AGENT_RUN_NOT_FOUND")


@router.get("/{run_id}/events", response_model=None)
async def stream_agent_run_events(run_id: UUID, principal: PrincipalDependency, coordinator: CoordinatorDependency, last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None) -> StreamingResponse | JSONResponse:  # noqa: E501
    authorization_error = _authorize(principal, run_id=run_id, permission="agent.run")
    if authorization_error is not None:
        return authorization_error
    try:
        cursor = int(last_event_id) if last_event_id is not None else 0
        if cursor < 0:
            raise ValueError
        await coordinator.view(run_id)
    except ValueError:
        return _problem(400, "Last-Event-ID is invalid", "LAST_EVENT_ID_INVALID")
    except AgentRunNotFoundError:
        return _problem(404, "Agent run was not found", "AGENT_RUN_NOT_FOUND")
    return StreamingResponse(
        _event_stream(coordinator, run_id, cursor),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _event_stream(coordinator: RunCoordinator, run_id: UUID, after_event_id: int) -> AsyncIterator[str]:
    cursor = after_event_id
    deadline = time.monotonic() + get_settings().event_stream_idle_timeout_seconds
    terminal = {
        AgentRunStatus.WAITING_FOR_USER,
        AgentRunStatus.COMPLETED,
        AgentRunStatus.FAILED,
        AgentRunStatus.CANCELLED,
    }
    while True:
        events = await coordinator.events(run_id, cursor)
        for event in events:
            cursor = event.event_id
            payload = json.dumps(event.model_dump(mode="json", by_alias=True), ensure_ascii=False)
            yield f"id: {event.event_id}\nevent: {event.type}\ndata: {payload}\n\n"
        view = await coordinator.view(run_id)
        if view.status in terminal or time.monotonic() >= deadline:
            return
        await asyncio.sleep(0.25)


@router.post("/{run_id}/resume", response_model=AgentRunAccepted, status_code=202)
async def resume_agent_run(run_id: UUID, body: ResumeAgentRunRequest, background_tasks: BackgroundTasks, http_request: Request, credentials: BearerDependency, principal: PrincipalDependency, coordinator: CoordinatorDependency) -> AgentRunAccepted | JSONResponse:  # noqa: E501
    authorization_error = _authorize(principal, run_id=run_id, permission="agent.respond")
    if authorization_error is not None:
        return authorization_error
    try:
        accepted, request = await coordinator.accept_resume(run_id, body)

    except AgentRunNotFoundError:
        return _problem(404, "Agent run was not found", "AGENT_RUN_NOT_FOUND")

    except AgentRunStateError:
        return _problem(409, "Agent run cannot be resumed", "AGENT_RUN_RESUME_CONFLICT")

    assert credentials is not None
    background_tasks.add_task(
        coordinator.resume,
        request,
        body,
        ExecutionAuthorization(credentials.credentials, http_request.state.traceparent),
    )
    return accepted


@router.post("/{run_id}/cancel", response_model=AgentRunView)
async def cancel_agent_run(run_id: UUID, principal: PrincipalDependency, coordinator: CoordinatorDependency) -> AgentRunView | JSONResponse:  # noqa: E501
    authorization_error = _authorize(principal, run_id=run_id, permission="agent.cancel")
    if authorization_error is not None:
        return authorization_error
    try:
        await coordinator.cancel(run_id)
        return await coordinator.view(run_id)

    except AgentRunNotFoundError:
        return _problem(404, "Agent run was not found", "AGENT_RUN_NOT_FOUND")

    except AgentRunStateError:
        return _problem(409, "Agent run cannot be cancelled", "AGENT_RUN_CANCEL_CONFLICT")
