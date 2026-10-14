"""내부 API에서 공유하는 위임 토큰 검증과 실행 권한 검사."""

from typing import Annotated, cast
from uuid import UUID

from fastapi import Depends, Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from security import DelegationPrincipal, DelegationTokenVerifier, TokenVerificationError

from .responses import problem_response

bearer = HTTPBearer(auto_error=False)


def delegation_verifier(request: Request) -> DelegationTokenVerifier:
    return cast(DelegationTokenVerifier, request.app.state.delegation_token_verifier)


BearerDependency = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]
VerifierDependency = Annotated[DelegationTokenVerifier, Depends(delegation_verifier)]


def delegated_principal(credentials: BearerDependency, verifier: VerifierDependency) -> DelegationPrincipal | JSONResponse:  # noqa: E501
    if credentials is None or credentials.scheme.lower() != "bearer":
        return problem_response(401, "Delegation token is required", "DELEGATION_TOKEN_REQUIRED", include_type=True)
    try:
        return verifier.verify(credentials.credentials)
    except TokenVerificationError:
        return problem_response(401, "Delegation token is invalid", "DELEGATION_TOKEN_INVALID", include_type=True)


PrincipalDependency = Annotated[DelegationPrincipal | JSONResponse, Depends(delegated_principal)]


def authorize_run(principal: DelegationPrincipal | JSONResponse, *, run_id: UUID, permission: str) -> JSONResponse | None:  # noqa: E501
    if isinstance(principal, JSONResponse):
        return principal
    try:
        DelegationTokenVerifier.authorize_run(principal, run_id=run_id, permission=permission)
    except TokenVerificationError:
        return problem_response(403, "Delegated permission is insufficient", "DELEGATION_FORBIDDEN", include_type=True)
    return None
