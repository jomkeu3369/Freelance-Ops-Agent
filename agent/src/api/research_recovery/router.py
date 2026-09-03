"""Fresh Spring-authorized recovery and run-scoped event replay."""

# ruff: noqa: E501

from typing import cast
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from api.agent_runs.router import BearerDependency, PrincipalDependency, _authorize, _problem
from runtime.research_recovery import ResearchRecoveryRequest, ResearchRecoveryResponse, ResearchRecoveryService
from runtime.runs import AgentRunNotFoundError
from runtime.task_contracts import TaskContractError
from runtime.task_guard import TaskGuardRejection
from runtime.task_registry import AttemptNotFoundError, TaskNotFoundError
from security import TokenVerificationError

router = APIRouter(prefix="/internal/v1/agent-runs/{run_id}/research-recovery", tags=["ResearchRecovery"])


@router.post("", response_model=ResearchRecoveryResponse)
async def recover_research(run_id: UUID, body: ResearchRecoveryRequest, request: Request, credentials: BearerDependency, principal: PrincipalDependency) -> ResearchRecoveryResponse | JSONResponse:
    error = _authorize(principal, run_id=run_id, permission="agent.task.recover")
    if error is not None:
        return error
    service = cast(ResearchRecoveryService | None, request.app.state.research_recovery_service)
    if service is None:
        return _problem(503, "Research recovery is disabled", "RESEARCH_RECOVERY_UNAVAILABLE")
    assert credentials is not None
    try:
        return await service.restore(run_id, body, credentials.credentials)
    except TokenVerificationError:
        return _problem(403, "Research recovery exceeds delegated authority", "RESEARCH_RECOVERY_FORBIDDEN")
    except (AgentRunNotFoundError, TaskNotFoundError, AttemptNotFoundError):
        return _problem(404, "Research recovery reference is unavailable", "RESEARCH_RECOVERY_NOT_FOUND")
    except (TaskGuardRejection, TaskContractError, ValueError):
        return _problem(409, "Research recovery conflicts with current state", "RESEARCH_RECOVERY_CONFLICT")
