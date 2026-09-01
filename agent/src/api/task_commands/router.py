"""Spring-only endpoint for idempotent Task command delivery."""

# ruff: noqa: E501, I001

from __future__ import annotations

from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from api.agent_runs.router import PrincipalDependency, _authorize, _problem
from runtime import PostgresTaskCommandInbox, TaskCommand, TaskCommandAcceptance, TaskCommandConflictError, TaskCommandInboxError, TaskCommandType, TaskRevisionConflictError
from security import DelegationPrincipal

router = APIRouter(prefix="/internal/v1/agent-runs/{run_id}/task-commands", tags=["AgentTaskCommands"])


def _inbox(request: Request) -> PostgresTaskCommandInbox | None:
    return cast(PostgresTaskCommandInbox | None, request.app.state.task_command_inbox)


InboxDependency = Annotated[PostgresTaskCommandInbox | None, Depends(_inbox)]


@router.post("", response_model=TaskCommandAcceptance, status_code=202)
async def accept_task_command(run_id: UUID, body: TaskCommand, principal: PrincipalDependency, inbox: InboxDependency) -> TaskCommandAcceptance | JSONResponse:
    permission = "agent.cancel" if body.type is TaskCommandType.CANCEL else "agent.respond"
    authorization_error = _authorize(principal, run_id=run_id, permission=permission)
    if authorization_error is not None:
        return authorization_error
    assert isinstance(principal, DelegationPrincipal)
    if body.run_id != run_id or body.workspace_id != principal.workspace_id or body.requested_by != principal.initiated_by:
        return _problem(403, "Task command exceeds delegated authority", "TASK_COMMAND_FORBIDDEN")
    if inbox is None:
        return _problem(503, "Task command inbox is unavailable", "TASK_COMMAND_INBOX_UNAVAILABLE")
    try:
        return await inbox.accept(body)
    except (TaskCommandConflictError, TaskRevisionConflictError):
        return _problem(409, "Task command conflicts with current revision", "TASK_COMMAND_CONFLICT")
    except TaskCommandInboxError:
        return _problem(422, "Task command contract is invalid", "TASK_COMMAND_INVALID")
