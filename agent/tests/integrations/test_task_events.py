from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest

from integrations.task_events import SpringTaskEventClient, SpringTaskEventError, TaskEventPublisher
from runtime.task_attempt_events import InMemoryTaskAttemptEventStore, TaskAttemptEventWrite


def event() -> TaskAttemptEventWrite:
    return TaskAttemptEventWrite(
        event_id="event-1",
        run_id=uuid4(),
        source="worker",
        source_event_id="worker-event-1",
        task_id=uuid4(),
        task_revision=2,
        attempt_id=uuid4(),
        attempt_number=1,
        workspace_id=uuid4(),
        sequence=1,
        event_type="attempt.started",
        phase="research",
        milestone="collecting sources",
        occurred_at=datetime.now(UTC),
    )


async def test_publisher_acknowledges_exact_spring_batch_response() -> None:
    observed: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        observed.update(__import__("json").loads(request.content))
        assert request.headers["Authorization"] == "Bearer workload-token"
        return httpx.Response(200, json={"acceptedEventIds": ["event-1"]})

    store = InMemoryTaskAttemptEventStore()
    await store.append(event())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://backend:8080") as http_client:
        publisher = TaskEventPublisher(store, SpringTaskEventClient("http://backend:8080", client=http_client))
        assert await publisher.publish_once("workload-token") == 1
        assert await publisher.publish_once("workload-token") == 0

    payload = observed["events"]
    assert isinstance(payload, list)
    assert payload[0]["taskRevision"] == 2
    assert payload[0]["phase"] == "research"


async def test_publisher_releases_claim_for_retry_after_failure() -> None:
    store = InMemoryTaskAttemptEventStore()
    await store.append(event())
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(503)), base_url="http://backend:8080"
    ) as http_client:
        publisher = TaskEventPublisher(store, SpringTaskEventClient("http://backend:8080", client=http_client))
        with pytest.raises(SpringTaskEventError, match="UNAVAILABLE"):
            await publisher.publish_once("workload-token")

    assert await store.claim_for_delivery() == []
