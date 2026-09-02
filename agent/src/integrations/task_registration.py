"""Spring control-plane client for idempotent Task and Attempt registration."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, Field


class SpringTaskRegistrationError(RuntimeError):
    pass


class RegisteredTaskProjection(BaseModel):
    model_config = ConfigDict(alias_generator=lambda value: "".join(word if index == 0 else word.capitalize() for index, word in enumerate(value.split("_"))), populate_by_name=True, extra="ignore")

    task_id: UUID
    workspace_id: UUID
    run_id: UUID
    status: str
    revision: int = Field(ge=1)
    current_attempt_number: int = Field(ge=1)


class RegisteredAttemptProjection(BaseModel):
    model_config = RegisteredTaskProjection.model_config

    attempt_id: UUID
    task_id: UUID
    task_revision: int = Field(ge=1)
    attempt_number: int = Field(ge=1)
    status: str
    queued_at: datetime


class SpringTaskRegistration(BaseModel):
    model_config = RegisteredTaskProjection.model_config

    task: RegisteredTaskProjection
    attempt: RegisteredAttemptProjection
    authorization_revision: int = Field(ge=1)
    budget_revision: int = Field(ge=1)


class SpringTaskRegistrationClient:
    def __init__(self, base_url: str, *, timeout_seconds: float = 10, client: Any | None = None) -> None:
        if not base_url.strip() or timeout_seconds <= 0:
            raise ValueError("Spring Task registration client configuration is invalid")
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._client = client

    async def register(self, payload: dict[str, object], workload_token: str) -> SpringTaskRegistration:
        if not workload_token.strip():
            raise SpringTaskRegistrationError("SPRING_TASK_REGISTRATION_AUTHORIZATION_REQUIRED")
        client = self._client
        owns_client = client is None
        if client is None:
            client = httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout_seconds)
        try:
            response = await client.post("/internal/v1/agent-control/tasks", headers={"Authorization": f"Bearer {workload_token}"}, json=payload)
        except httpx.HTTPError as error:
            raise SpringTaskRegistrationError("SPRING_TASK_REGISTRATION_UNAVAILABLE") from error
        finally:
            if owns_client:
                await client.aclose()
        if response.status_code in {401, 403}:
            raise SpringTaskRegistrationError("SPRING_TASK_REGISTRATION_FORBIDDEN")
        if response.status_code < 200 or response.status_code >= 300:
            raise SpringTaskRegistrationError("SPRING_TASK_REGISTRATION_REJECTED")
        try:
            return SpringTaskRegistration.model_validate(response.json())
        except (TypeError, ValueError) as error:
            raise SpringTaskRegistrationError("SPRING_TASK_REGISTRATION_RESPONSE_INVALID") from error
