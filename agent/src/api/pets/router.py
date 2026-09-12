"""Generate safe profile values; never save business data from the Agent."""

import asyncio
import json
from typing import Literal, cast
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import Field, ValidationError

from api.assumptions.router import BearerDependency, VerifierDependency, _problem
from contracts import ModelSelection, PetProfile, Provider, StrictModel, TrustedRunContext
from gateway import AIGateway
from personal_credentials import credential_scope
from providers import ProviderCallError
from security import DelegationTokenVerifier, TokenVerificationError

router = APIRouter(prefix="/internal/v1/pets", tags=["Pets"])


class GeneratePetRequest(StrictModel):
    context: TrustedRunContext
    model_selection: ModelSelection
    description: str = Field(min_length=1, max_length=500)
    slot: Literal["LEAN", "RECOMMENDED", "EXPANDED"]


class GeneratePetResponse(StrictModel):
    run_id: UUID
    profile: PetProfile
    provider: Provider
    model: str
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)


@router.post("/generate", response_model=GeneratePetResponse)
async def generate_pet(body: GeneratePetRequest, request: Request, credentials: BearerDependency, verifier: VerifierDependency) -> GeneratePetResponse | JSONResponse:  # noqa: E501
    if credentials is None or credentials.scheme.lower() != "bearer":
        return _problem(401, "Delegation token required", "DELEGATION_TOKEN_REQUIRED")
    try:
        principal = verifier.verify(credentials.credentials)
        DelegationTokenVerifier.authorize_run(principal, run_id=body.context.run_id, permission="agent.run")
        if (
            principal.workspace_id != body.context.workspace_id
            or principal.project_id != body.context.project_id
            or principal.initiated_by != body.context.initiated_by
            or "project.read" not in principal.permissions
            or not set(body.context.effective_permissions).issubset(principal.permissions)
        ):
            return _problem(403, "Context exceeds authority", "DELEGATION_FORBIDDEN")
    except TokenVerificationError:
        return _problem(403, "Invalid delegation", "DELEGATION_FORBIDDEN")
    gateway = cast(AIGateway | None, request.app.state.ai_gateway)
    if gateway is None:
        return _problem(503, "AI unavailable", "AI_GATEWAY_UNAVAILABLE")
    try:
        async with asyncio.timeout(30):
            with credential_scope(credentials.credentials, body.context.run_id):
                generated = await gateway.generate_pet(
                    body.model_selection,
                    json.dumps({"slot": body.slot, "description": body.description}, ensure_ascii=False),
                    max_output_tokens=1000,
                    max_attempts=1
                )
        profile = PetProfile.model_validate(generated.payload)
        if profile.slot != body.slot:
            return _problem(502, "Invalid pet slot", "PET_GENERATION_FAILED")
        return GeneratePetResponse(
            run_id=body.context.run_id,
            profile=profile,
            provider=body.model_selection.provider,
            model=body.model_selection.model,
            input_tokens=generated.input_tokens,
            output_tokens=generated.output_tokens
        )
    except (ProviderCallError, ValidationError, TimeoutError):
        return _problem(502, "Pet generation failed", "PET_GENERATION_FAILED")
