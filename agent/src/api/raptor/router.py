"""Spring-only storage-neutral RAPTOR build endpoint."""

from __future__ import annotations

import asyncio
from typing import Annotated, Protocol, cast

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from api.agent_runs.router import _authorize, _principal, _problem
from config import get_settings
from contracts import RaptorBuildRequest, RaptorBuildResponse
from security import DelegationPrincipal


class RaptorBuildService(Protocol):
    async def build(self, request: RaptorBuildRequest) -> RaptorBuildResponse: ...


router = APIRouter(prefix="/internal/v1/raptor", tags=["Raptor"])


def _service(request: Request) -> RaptorBuildService:
    return cast(RaptorBuildService, request.app.state.raptor_build_service)


RaptorPrincipal = Annotated[DelegationPrincipal | JSONResponse, Depends(_principal)]
RaptorServiceDependency = Annotated[RaptorBuildService, Depends(_service)]


@router.post("/build", response_model=RaptorBuildResponse)
async def build_raptor_index(body: RaptorBuildRequest, principal: RaptorPrincipal, service: RaptorServiceDependency) -> RaptorBuildResponse | JSONResponse:  # noqa: E501
    authorization_error = _authorize(
        principal,
        run_id=body.context.run_id,
        permission="knowledge.index",
    )
    if authorization_error is not None:
        return authorization_error
    assert isinstance(principal, DelegationPrincipal)
    if (
        principal.workspace_id != body.context.workspace_id
        or principal.project_id != body.context.project_id
    ):
        return _problem(403, "RAPTOR context exceeds delegated authority", "RAPTOR_CONTEXT_FORBIDDEN")
    try:
        return await asyncio.wait_for(
            service.build(body),
            timeout=get_settings().raptor_build_timeout_seconds,
        )
    except TimeoutError:
        return _problem(504, "RAPTOR build timed out", "RAPTOR_BUILD_TIMEOUT")
    except ValueError:
        return _problem(400, "RAPTOR build request is invalid", "RAPTOR_BUILD_INVALID")
    except Exception:
        return _problem(502, "RAPTOR provider failed", "RAPTOR_PROVIDER_FAILED")
