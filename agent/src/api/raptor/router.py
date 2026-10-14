"""Spring 서버가 호출하는 RAPTOR 생성 API. 저장은 호출자가 담당한다."""

from __future__ import annotations

import asyncio
from typing import Annotated, Protocol, cast

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from api.dependencies import authorize_run, delegated_principal
from api.responses import problem_response
from config import get_settings
from contracts import RaptorBuildRequest, RaptorBuildResponse
from platform_budget import PlatformBudgetError, reject_unbounded_operation
from security import DelegationPrincipal


class RaptorBuildService(Protocol):
    async def build(self, request: RaptorBuildRequest) -> RaptorBuildResponse: ...


router = APIRouter(prefix="/internal/v1/raptor", tags=["Raptor"])


def _service(request: Request) -> RaptorBuildService:
    return cast(RaptorBuildService, request.app.state.raptor_build_service)


RaptorPrincipal = Annotated[DelegationPrincipal | JSONResponse, Depends(delegated_principal)]
RaptorServiceDependency = Annotated[RaptorBuildService, Depends(_service)]


@router.post("/build", response_model=RaptorBuildResponse)
async def build_raptor_index(body: RaptorBuildRequest, principal: RaptorPrincipal, service: RaptorServiceDependency) -> RaptorBuildResponse | JSONResponse:  # noqa: E501
    authorization_error = authorize_run(principal, run_id=body.context.run_id, permission="knowledge.index")
    if authorization_error is not None:
        return authorization_error
    assert isinstance(principal, DelegationPrincipal)
    if principal.workspace_id != body.context.workspace_id or principal.project_id != body.context.project_id:
        return problem_response(
            403, "RAPTOR context exceeds delegated authority", "RAPTOR_CONTEXT_FORBIDDEN", include_type=True
        )
    try:
        reject_unbounded_operation("RAPTOR")
    except PlatformBudgetError as error:
        return problem_response(409, "Platform budget is required for this operation", error.code, include_type=True)
    try:
        return await asyncio.wait_for(service.build(body), timeout=get_settings().raptor_build_timeout_seconds)
    except TimeoutError:
        return problem_response(504, "RAPTOR build timed out", "RAPTOR_BUILD_TIMEOUT", include_type=True)
    except ValueError:
        return problem_response(400, "RAPTOR build request is invalid", "RAPTOR_BUILD_INVALID", include_type=True)
    except Exception:
        return problem_response(502, "RAPTOR provider failed", "RAPTOR_PROVIDER_FAILED", include_type=True)
