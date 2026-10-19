"""영속 금액 예약이 있는 요청만 픽셀 펫 모델에 전달한다."""

import asyncio
import json
from decimal import Decimal
from typing import cast

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from langsmith import tracing_context
from pydantic import Field, ValidationError

from api.dependencies import BearerDependency, VerifierDependency
from api.responses import problem_response
from config import get_settings
from contracts import (
    AgentRunUsage,
    ModelSelection,
    PetProfile,
    PlatformBudget,
    RunBudget,
    StrictModel,
    TrustedRunContext,
)
from gateway import AIGateway
from platform_budget import PlatformBudgetError, PlatformSpendLedger, platform_budget_scope
from providers import ProviderCallError
from providers.pixel_pets import GeneratedPixelPet
from security import DelegationTokenVerifier, TokenVerificationError

router = APIRouter(prefix="/internal/v1/pets", tags=["Pets"])


class GeneratePixelPetRequest(StrictModel):
    context: TrustedRunContext
    model_selection: ModelSelection
    description: str = Field(min_length=1, max_length=500)
    previous: PetProfile | None = None
    platform_budget: PlatformBudget
    budget: RunBudget


class GeneratePixelPetResponse(StrictModel):
    profile: GeneratedPixelPet
    usage: AgentRunUsage


@router.post("/generate-pixel", response_model=GeneratePixelPetResponse)
async def generate_pixel_pet(body: GeneratePixelPetRequest, request: Request, credentials: BearerDependency, verifier: VerifierDependency) -> GeneratePixelPetResponse | JSONResponse:  # noqa: E501
    if credentials is None or credentials.scheme.lower() != "bearer":
        return problem_response(401, "Delegation token required", "DELEGATION_TOKEN_REQUIRED")
    try:
        principal = verifier.verify(credentials.credentials)
        DelegationTokenVerifier.authorize_run(principal, run_id=body.context.run_id, permission="agent.run")
        if (
            principal.workspace_id != body.context.workspace_id
            or principal.project_id != body.context.project_id
            or principal.initiated_by != body.context.initiated_by
            or "project.read" not in principal.permissions
            or not set(body.context.effective_permissions).issubset(principal.permissions)
            or body.platform_budget.reservation_id != body.context.run_id
            or body.platform_budget.max_cost_usd > Decimal("0.10")
            or body.model_selection.credential_id is not None
            or body.budget.max_model_calls != 1
            or body.budget.max_output_tokens > 4096
            or body.budget.max_input_tokens > 32000
            or body.budget.max_duration_seconds > 60
        ):
            return problem_response(403, "Context exceeds authority", "DELEGATION_FORBIDDEN")
    except TokenVerificationError:
        return problem_response(403, "Invalid delegation", "DELEGATION_FORBIDDEN")
    gateway = cast(AIGateway | None, request.app.state.ai_gateway)
    if gateway is None:
        return problem_response(503, "AI unavailable", "AI_GATEWAY_UNAVAILABLE")
    ledger = PlatformSpendLedger(body.platform_budget, run_budget=body.budget)

    async def persist(usage: AgentRunUsage) -> None:
        settings = get_settings()
        async with httpx.AsyncClient(timeout=settings.backend_tool_timeout_seconds, follow_redirects=False) as client:
            response = await client.post(
                f"{settings.backend_internal_url.rstrip('/')}/internal/v1/pet-generations/{body.context.run_id}/usage",
                headers={"Authorization": f"Bearer {credentials.credentials}", "X-Run-Id": str(body.context.run_id)},
                json=usage.model_dump(mode="json", by_alias=True)
            )
            response.raise_for_status()

    ledger.persist_usage = persist
    try:
        with platform_budget_scope(ledger), tracing_context(enabled=False):
            async with asyncio.timeout(body.budget.max_duration_seconds):
                generated = await gateway.generate_pixel_pet(
                    body.model_selection,
                    json.dumps(
                        {
                            "description": body.description,
                            "previous": body.previous.model_dump(mode="json") if body.previous else None
                        },
                        ensure_ascii=False
                    ),
                    max_output_tokens=body.budget.max_output_tokens,
                    max_attempts=1
                )
                profile = GeneratedPixelPet.model_validate(generated.payload)
        # 그림까지 먼저 영속화한다. 응답을 잃어도 같은 생성 ID로 결과를 다시 읽을 수 있다.
        settings = get_settings()
        async with httpx.AsyncClient(timeout=settings.backend_tool_timeout_seconds, follow_redirects=False) as client:
            response = await client.post(
                f"{settings.backend_internal_url.rstrip('/')}/internal/v1/pet-generations/{body.context.run_id}/complete",
                headers={"Authorization": f"Bearer {credentials.credentials}", "X-Run-Id": str(body.context.run_id)},
                json={
                    "profile": profile.model_dump(mode="json", by_alias=True),
                    "usage": ledger.report(None).model_dump(mode="json", by_alias=True)
                }
            )
            response.raise_for_status()
        return GeneratePixelPetResponse(profile=profile, usage=ledger.report(None))
    except (ProviderCallError, ValidationError, TimeoutError, PlatformBudgetError, httpx.HTTPError):
        return problem_response(502, "Pixel pet generation failed", "PET_GENERATION_FAILED")
    finally:
        # 확인된 시도와 불명확한 사용량 모두 저장하며, 호출 전 기록이 없으면 공급자를 호출하지 않는다.
        ledger.closed = True
        await persist(ledger.report(None))
