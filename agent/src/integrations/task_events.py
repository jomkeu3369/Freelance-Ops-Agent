"""Durable delivery of sanitized TaskAttempt events to the Spring control plane."""

from __future__ import annotations

from typing import Any

import httpx

from runtime.task_attempt_events import ClaimedTaskAttemptEvent, TaskAttemptEventRecord, TaskAttemptEventStore


class SpringTaskEventError(RuntimeError):
    pass


class SpringTaskEventClient:
    def __init__(self, base_url: str, *, timeout_seconds: float = 10.0, client: Any | None = None) -> None:
        if not base_url.strip() or timeout_seconds <= 0:
            raise ValueError("Spring TaskEvent client configuration is invalid")
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._client = client

    async def publish(self, claims: list[ClaimedTaskAttemptEvent], workload_token: str) -> set[str]:
        if not workload_token.strip():
            raise SpringTaskEventError("SPRING_TASK_EVENT_AUTHORIZATION_REQUIRED")
        if not claims:
            return set()
        client = self._client
        owns_client = client is None
        if client is None:
            client = httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout_seconds)
        try:
            response = await client.post(
                "/internal/v1/agent-control/task-events:batch",
                headers={"Authorization": f"Bearer {workload_token}"},
                json={"events": [_payload(claim) for claim in claims]},
            )
        except httpx.HTTPError as error:
            raise SpringTaskEventError("SPRING_TASK_EVENT_UNAVAILABLE") from error
        finally:
            if owns_client:
                await client.aclose()
        if response.status_code in {401, 403}:
            raise SpringTaskEventError("SPRING_TASK_EVENT_FORBIDDEN")
        if response.status_code < 200 or response.status_code >= 300:
            raise SpringTaskEventError("SPRING_TASK_EVENT_UNAVAILABLE")
        try:
            acknowledgements = response.json()["acknowledgements"]
        except (KeyError, TypeError, ValueError) as error:
            raise SpringTaskEventError("SPRING_TASK_EVENT_RESPONSE_INVALID") from error
        if not isinstance(acknowledgements, list):
            raise SpringTaskEventError("SPRING_TASK_EVENT_RESPONSE_INVALID")
        expected = {claim.record.event_id: claim.record for claim in claims}
        result: set[str] = set()
        for acknowledgement in acknowledgements:
            if not isinstance(acknowledgement, dict):
                raise SpringTaskEventError("SPRING_TASK_EVENT_RESPONSE_INVALID")
            event_id = acknowledgement.get("eventId")
            if not isinstance(event_id, str):
                raise SpringTaskEventError("SPRING_TASK_EVENT_RESPONSE_INVALID")
            event = expected.get(event_id)
            if event is None or event_id in result or not _matches_acknowledgement(acknowledgement, event):
                raise SpringTaskEventError("SPRING_TASK_EVENT_RESPONSE_INVALID")
            result.add(event_id)
        return result


class TaskEventPublisher:
    def __init__(self, store: TaskAttemptEventStore, client: SpringTaskEventClient) -> None:
        self._store = store
        self._client = client

    async def publish_once(self, workload_token: str, *, batch_size: int = 100) -> int:
        claims = await self._store.claim_for_delivery(limit=batch_size)
        if not claims:
            return 0
        try:
            accepted_ids = await self._client.publish(claims, workload_token)
        except SpringTaskEventError as error:
            await self._store.retry_delivery(
                claims,
                delay_seconds=_retry_delay(max(claim.delivery_attempt for claim in claims)),
                error=str(error),
            )
            raise
        accepted = [claim for claim in claims if claim.record.event_id in accepted_ids]
        missing = [claim for claim in claims if claim.record.event_id not in accepted_ids]
        if accepted:
            await self._store.acknowledge_delivery(accepted)
        if missing:
            await self._store.retry_delivery(missing, delay_seconds=1, error="Spring did not acknowledge event")
        return len(accepted)


def _payload(claim: ClaimedTaskAttemptEvent) -> dict[str, object]:
    event = claim.record
    return {
        "eventId": event.event_id,
        "runId": str(event.run_id),
        "workspaceId": str(event.workspace_id),
        "taskId": str(event.task_id),
        "taskRevision": event.task_revision,
        "attemptId": str(event.attempt_id),
        "attemptNumber": event.attempt_number,
        "schemaVersion": event.schema_version,
        "source": event.source,
        "sourceEventId": event.source_event_id,
        "sequence": event.sequence,
        "eventType": event.event_type,
        "phase": event.phase,
        "milestone": event.milestone,
        "data": dict(event.data),
        "occurredAt": event.occurred_at.isoformat().replace("+00:00", "Z"),
    }


def _matches_acknowledgement(acknowledgement: dict[object, object], record: TaskAttemptEventRecord) -> bool:
    return acknowledgement == {
        "eventId": record.event_id,
        "workspaceId": str(record.workspace_id),
        "runId": str(record.run_id),
        "taskId": str(record.task_id),
        "taskRevision": record.task_revision,
        "attemptId": str(record.attempt_id),
        "attemptNumber": record.attempt_number,
        "source": record.source,
        "sourceEventId": record.source_event_id,
        "sequence": record.sequence,
    }


def _retry_delay(attempt: int) -> int:
    return min(60, 1 << min(max(attempt - 1, 0), 6))
