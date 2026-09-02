from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest

from integrations.task_registration import SpringTaskRegistrationClient, SpringTaskRegistrationError


async def test_registration_validates_authoritative_task_and_attempt_response() -> None:
    task_id = uuid4()
    attempt_id = uuid4()
    workspace_id = uuid4()
    run_id = uuid4()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer workload-token"
        return httpx.Response(201, json={"task": {"taskId": str(task_id), "workspaceId": str(workspace_id), "runId": str(run_id), "status": "DISPATCHED", "revision": 1, "currentAttemptNumber": 1}, "attempt": {"attemptId": str(attempt_id), "taskId": str(task_id), "taskRevision": 1, "attemptNumber": 1, "status": "QUEUED", "queuedAt": datetime.now(UTC).isoformat()}, "authorizationRevision": 7, "budgetRevision": 1})  # noqa: E501

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://backend:8080") as http_client:
        result = await SpringTaskRegistrationClient("http://backend:8080", client=http_client).register({"taskId": str(task_id)}, "workload-token")  # noqa: E501

    assert result.task.task_id == task_id
    assert result.attempt.attempt_id == attempt_id
    assert result.authorization_revision == 7


async def test_registration_rejects_missing_workload_token() -> None:
    with pytest.raises(SpringTaskRegistrationError, match="AUTHORIZATION_REQUIRED"):
        await SpringTaskRegistrationClient("http://backend:8080").register({}, "")
