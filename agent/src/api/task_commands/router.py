"""Spring 서버의 작업 명령을 중복 적용 없이 접수한다."""

from __future__ import annotations

from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from api.dependencies import PrincipalDependency, authorize_run
from api.responses import problem_response
from runtime import (
    PostgresTaskCommandInbox,
    TaskCommand,
    TaskCommandAcceptance,
    TaskCommandConflictError,
    TaskCommandInboxError,
    TaskCommandType,
    TaskRevisionConflictError,
)
from security import DelegationPrincipal

router = APIRouter(prefix="/internal/v1/agent-runs/{run_id}/task-commands", tags=["AgentTaskCommands"])


def _inbox(request: Request) -> PostgresTaskCommandInbox | None:
    return cast(PostgresTaskCommandInbox | None, request.app.state.task_command_inbox)


InboxDependency = Annotated[PostgresTaskCommandInbox | None, Depends(_inbox)]


@router.post("", response_model=TaskCommandAcceptance, status_code=202)
async def accept_task_command(run_id: UUID, body: TaskCommand, principal: PrincipalDependency, inbox: InboxDependency) -> TaskCommandAcceptance | JSONResponse:  # noqa: E501
    permission = "agent.cancel" if body.type is TaskCommandType.CANCEL else "agent.respond"
    authorization_error = authorize_run(principal, run_id=run_id, permission=permission)
    if authorization_error is not None:
        return authorization_error
    assert isinstance(principal, DelegationPrincipal)
    if (
        body.run_id != run_id
        or body.workspace_id != principal.workspace_id
        or body.requested_by != principal.initiated_by
    ):
        return problem_response(
            403, "Task command exceeds delegated authority", "TASK_COMMAND_FORBIDDEN", include_type=True
        )
    if inbox is None:
        return problem_response(
            503, "Task command inbox is unavailable", "TASK_COMMAND_INBOX_UNAVAILABLE", include_type=True
        )
    try:
        return await inbox.accept(body)
    except (TaskCommandConflictError, TaskRevisionConflictError):
        return problem_response(
            409, "Task command conflicts with current revision", "TASK_COMMAND_CONFLICT", include_type=True
        )
    except TaskCommandInboxError:
        return problem_response(422, "Task command contract is invalid", "TASK_COMMAND_INVALID", include_type=True)
