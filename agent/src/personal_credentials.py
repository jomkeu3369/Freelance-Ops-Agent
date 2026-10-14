"""위임된 인증 정보를 일시적으로 조회한다. 저장되는 계약 모델에는 인증 정보를 넣지 않는다."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from uuid import UUID

import httpx

from contracts import ModelSelection

_authorization: ContextVar[tuple[str, UUID] | None] = ContextVar("personal_credential_authorization", default=None)


@contextmanager
def credential_scope(token: str | None, run_id: UUID) -> Iterator[None]:
    scope = _authorization.set((token, run_id) if token else None)
    try:
        yield
    finally:
        _authorization.reset(scope)


async def resolve_credential(selection: ModelSelection, backend_url: str, timeout: float) -> str:
    authorization = _authorization.get()
    if authorization is None or selection.credential_id is None:
        raise ValueError("Personal credential authorization unavailable")
    token, run_id = authorization
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False) as client:
        response = await client.get(
            f"{backend_url.rstrip('/')}/internal/v1/ai-connections/{selection.credential_id}/credential",
            params={"provider": selection.provider.value, "model": selection.model},
            headers={"Authorization": f"Bearer {token}", "X-Run-Id": str(run_id)}
        )
        if response.status_code != 200:
            raise ValueError("Personal credential unavailable")
        key = response.json().get("apiKey")
        if not isinstance(key, str) or not key:
            raise ValueError("Personal credential unavailable")
        return key
