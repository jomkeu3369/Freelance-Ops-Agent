"""Spring-only quotation assumption suggestion endpoint."""

from __future__ import annotations

import json
import time
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from contracts import (
    AssumptionSuggestionRequest,
    AssumptionSuggestionResponse,
    AssumptionSuggestionUsage,
)
from gateway import AIGateway
from providers import ProviderCallError
from security import DelegationPrincipal, DelegationTokenVerifier, TokenVerificationError

router = APIRouter(prefix="/internal/v1/quotation-assumptions", tags=["QuotationAssumptions"])
bearer = HTTPBearer(auto_error=False)


def _problem(status: int, title: str, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        media_type="application/problem+json",
        content={"title": title, "status": status, "code": code}
    )


def _verifier(request: Request) -> DelegationTokenVerifier:
    return cast(DelegationTokenVerifier, request.app.state.delegation_token_verifier)


BearerDependency = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]
VerifierDependency = Annotated[DelegationTokenVerifier, Depends(_verifier)]


@router.post("/suggest", response_model=AssumptionSuggestionResponse)
async def suggest_assumption(body: AssumptionSuggestionRequest, request: Request, credentials: BearerDependency, verifier: VerifierDependency) -> AssumptionSuggestionResponse | JSONResponse:  # noqa: E501
    if credentials is None or credentials.scheme.lower() != "bearer":
        return _problem(401, "Delegation token is required", "DELEGATION_TOKEN_REQUIRED")
    try:
        principal = verifier.verify(credentials.credentials)
        DelegationTokenVerifier.authorize_run(principal, run_id=body.context.run_id, permission="agent.run")
    except TokenVerificationError:
        return _problem(403, "Delegated permission is insufficient", "DELEGATION_FORBIDDEN")

    if not _matches_context(principal, body) or "quotation.write" not in principal.permissions:
        return _problem(403, "Suggestion context exceeds delegated authority", "SUGGESTION_CONTEXT_FORBIDDEN")

    gateway = cast(AIGateway | None, request.app.state.ai_gateway)
    if gateway is None:
        return _problem(503, "AI gateway is unavailable", "AI_GATEWAY_UNAVAILABLE")

    prompt = json.dumps(
        {
            "project_requirement": body.project_requirement,
            "quotation_item": {
                "title": body.item_title,
                "description": body.item_description,
                "quantity": body.quantity,
                "unit": body.unit,
            },
            "current_assumption": body.current_assumption or None,
            "instruction": "기존 문장이 있으면 더 명확하고 검증 가능한 가정으로 다듬고, 없으면 새로 작성하세요.",
        },
        ensure_ascii=False
    )
    started = time.monotonic()
    try:
        generation = await gateway.generate_assumption(
            body.model_selection,
            prompt,
            max_output_tokens=500,
            max_attempts=2
        )
    except ProviderCallError:
        return _problem(502, "Assumption suggestion failed", "ASSUMPTION_MODEL_FAILED")

    content = str(generation.payload.get("content", "")).strip()
    if not content:
        return _problem(502, "Assumption suggestion was empty", "ASSUMPTION_EMPTY")
    return AssumptionSuggestionResponse(
        run_id=body.context.run_id,
        content=content,
        provider=body.model_selection.provider,
        model=body.model_selection.model,
        usage=AssumptionSuggestionUsage(
            model_calls=generation.model_calls,
            input_tokens=generation.input_tokens,
            output_tokens=generation.output_tokens,
            retry_count=max(0, generation.model_calls - 1),
            duration_ms=max(0, round((time.monotonic() - started) * 1000))
        )
    )


def _matches_context(principal: DelegationPrincipal, body: AssumptionSuggestionRequest) -> bool:
    return (
        principal.workspace_id == body.context.workspace_id
        and principal.project_id == body.context.project_id
        and principal.initiated_by == body.context.initiated_by
        and set(body.context.effective_permissions).issubset(principal.permissions)
    )
