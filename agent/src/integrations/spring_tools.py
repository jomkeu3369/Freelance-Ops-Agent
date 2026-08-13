"""Least-privilege wrappers for Spring-owned deterministic business tools."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

import httpx
from pydantic import BaseModel

from contracts import (
    DomainPack,
    ProjectContext,
    QuoteCalculationRequest,
    QuoteCalculationResult,
    RequirementDraft,
    RequirementValidationResult,
)

ToolResult = TypeVar("ToolResult", bound=BaseModel)


class SpringToolError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class SpringToolClient:
    def __init__(self, base_url: str, *, timeout_seconds: float = 10.0, read_max_attempts: int = 2, client: Any | None = None) -> None:  # noqa: E501
        if not base_url.strip() or timeout_seconds <= 0 or not 1 <= read_max_attempts <= 3:
            raise ValueError("Spring Tool client configuration is invalid")
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._read_max_attempts = read_max_attempts
        self._client = client

    async def get_project_context(self, delegation_token: str, *, run_id: UUID, project_id: UUID, max_attempts: int | None = None, traceparent: str | None = None) -> ProjectContext:  # noqa: E501
        response = await self._request(
            "GET",
            f"/internal/v1/projects/{project_id}/context",
            delegation_token,
            run_id,
            retry_read=True,
            max_attempts=max_attempts,
            traceparent=traceparent,
        )
        return self._validated(response, ProjectContext)

    async def get_domain_pack(self, delegation_token: str, *, run_id: UUID, domain_code: str, max_attempts: int | None = None, traceparent: str | None = None) -> DomainPack:  # noqa: E501
        response = await self._request(
            "GET",
            f"/internal/v1/domain-packs/{domain_code}",
            delegation_token,
            run_id,
            retry_read=True,
            max_attempts=max_attempts,
            traceparent=traceparent,
        )
        return self._validated(response, DomainPack)

    async def validate_requirements(self, delegation_token: str, *, run_id: UUID, draft: RequirementDraft, traceparent: str | None = None) -> RequirementValidationResult:  # noqa: E501
        response = await self._request(
            "POST",
            "/internal/v1/requirements/validate",
            delegation_token,
            run_id,
            json_body=draft.model_dump(mode="json", by_alias=True),
            traceparent=traceparent,
        )
        return self._validated(response, RequirementValidationResult)

    async def calculate_quote(self, delegation_token: str, *, run_id: UUID, request: QuoteCalculationRequest, traceparent: str | None = None) -> QuoteCalculationResult:  # noqa: E501
        response = await self._request(
            "POST",
            "/internal/v1/quotes/calculate",
            delegation_token,
            run_id,
            json_body=request.model_dump(mode="json", by_alias=True),
            traceparent=traceparent,
        )
        return self._validated(response, QuoteCalculationResult)

    async def _request(self, method: str, path: str, delegation_token: str, run_id: UUID, *, json_body: Mapping[str, object] | None = None, retry_read: bool = False, max_attempts: int | None = None, traceparent: str | None = None) -> Any:  # noqa: E501
        if not delegation_token.strip():
            raise SpringToolError("SPRING_TOOL_AUTHORIZATION_REQUIRED")
        client = self._client
        owns_client = client is None
        if client is None:
            client = httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout_seconds)
        attempts = self._read_max_attempts if retry_read else 1
        if max_attempts is not None:
            attempts = min(attempts, max_attempts)
        if attempts < 1:
            raise ValueError("Spring Tool max_attempts must be positive")
        try:
            for attempt in range(1, attempts + 1):
                try:
                    headers = {
                        "Authorization": f"Bearer {delegation_token}",
                        "X-Run-Id": str(run_id),
                    }
                    if traceparent is not None:
                        headers["traceparent"] = traceparent
                    response = await client.request(
                        method,
                        path,
                        headers=headers,
                        json=json_body,
                    )
                except httpx.TimeoutException as error:
                    if attempt >= attempts:
                        raise SpringToolError("SPRING_TOOL_TIMEOUT") from error
                    await asyncio.sleep(0.05 * attempt)
                    continue
                except httpx.HTTPError as error:
                    raise SpringToolError("SPRING_TOOL_UNAVAILABLE") from error
                if response.status_code in {502, 503, 504} and attempt < attempts:
                    await asyncio.sleep(0.05 * attempt)
                    continue
                return self._accepted_response(response)
            raise AssertionError("unreachable Spring Tool retry state")
        finally:
            if owns_client:
                await client.aclose()

    @staticmethod
    def _accepted_response(response: Any) -> Any:
        if response.status_code in {401, 403}:
            raise SpringToolError("SPRING_TOOL_FORBIDDEN")
        if response.status_code == 404:
            raise SpringToolError("SPRING_TOOL_NOT_FOUND")
        if response.status_code == 409:
            raise SpringToolError("SPRING_TOOL_CONFLICT")
        if response.status_code == 422 or response.status_code == 400:
            raise SpringToolError("SPRING_TOOL_INPUT_INVALID")
        if response.status_code < 200 or response.status_code >= 300:
            raise SpringToolError("SPRING_TOOL_UNAVAILABLE")
        return response

    @staticmethod
    def _validated(response: Any, model: type[ToolResult]) -> ToolResult:
        try:
            return model.model_validate(response.json())
        except (TypeError, ValueError) as error:
            raise SpringToolError("SPRING_TOOL_RESPONSE_INVALID") from error
