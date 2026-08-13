"""Verification of short-lived audience-bound delegation JWTs issued by Spring."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import jwt


class TokenVerificationError(ValueError):
    """Raised without exposing token contents or cryptographic details."""


@dataclass(frozen=True, slots=True)
class DelegationPrincipal:
    subject: str
    token_id: str
    run_id: UUID
    workspace_id: UUID
    project_id: UUID
    initiated_by: UUID
    permissions: frozenset[str]


class DelegationTokenVerifier:
    _ALLOWED_ALGORITHMS = frozenset({"RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "EdDSA"})

    def __init__(self, *, public_key: str, issuer: str, audience: str, algorithms: tuple[str, ...] = ("RS256",), leeway_seconds: int = 5, key_id: str | None = None, previous_public_keys: Mapping[str, str] | None = None) -> None:  # noqa: E501
        if not public_key.strip() or not issuer.strip() or not audience.strip():
            raise ValueError("delegation token verification settings must not be empty")
        if not algorithms or any(algorithm not in self._ALLOWED_ALGORITHMS for algorithm in algorithms):
            raise ValueError("delegation tokens require an asymmetric signing algorithm")
        previous_keys = dict(previous_public_keys or {})
        if any(not kid.strip() or not key.strip() for kid, key in previous_keys.items()):
            raise ValueError("delegation token rotation keys must not be empty")
        if key_id is not None and (not key_id.strip() or key_id in previous_keys):
            raise ValueError("active delegation key id must be non-empty and unique")
        self._public_key = public_key
        self._public_keys = ({key_id: public_key, **previous_keys} if key_id is not None else {})
        self._issuer = issuer
        self._audience = audience
        self._algorithms = algorithms
        self._leeway_seconds = leeway_seconds

    def verify(self, token: str) -> DelegationPrincipal:
        # 토큰 원문이나 암호화 오류 세부 정보는 외부 응답으로 전달하지 않는다.
        if not token.strip():
            raise TokenVerificationError("delegation token is required")
        try:
            public_key = self._verification_key(token)
            claims: dict[str, Any] = jwt.decode(
                token,
                public_key,
                algorithms=list(self._algorithms),
                audience=self._audience,
                issuer=self._issuer,
                leeway=self._leeway_seconds,
                options={"require": ["exp", "iat", "iss", "aud", "sub", "jti"]},
            )
            permissions = claims["permissions"]
            if not isinstance(permissions, list) or not all(isinstance(item, str) for item in permissions):
                raise ValueError("invalid permissions")
            principal = DelegationPrincipal(
                subject=str(claims["sub"]),
                token_id=str(claims["jti"]),
                run_id=UUID(str(claims["run_id"])),
                workspace_id=UUID(str(claims["workspace_id"])),
                project_id=UUID(str(claims["project_id"])),
                initiated_by=UUID(str(claims["initiated_by"])),
                permissions=frozenset(permissions),
            )
            if principal.subject != str(principal.initiated_by):
                raise ValueError("delegated subject does not match initiated_by")
            return principal
        except (KeyError, TypeError, ValueError, jwt.PyJWTError) as error:
            raise TokenVerificationError("delegation token is invalid") from error

    def _verification_key(self, token: str) -> str:
        if not self._public_keys:
            return self._public_key
        header = jwt.get_unverified_header(token)
        key_id = header.get("kid")
        if not isinstance(key_id, str) or key_id not in self._public_keys:
            raise TokenVerificationError("delegation token is invalid")
        return self._public_keys[key_id]

    @staticmethod
    def authorize_run(principal: DelegationPrincipal, *, run_id: UUID, permission: str) -> None:
        if principal.run_id != run_id or permission not in principal.permissions:
            raise TokenVerificationError("delegation token is not authorized for this run")
