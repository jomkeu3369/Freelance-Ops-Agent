import json
from dataclasses import replace
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


def acknowledgement(task_event: TaskAttemptEventWrite) -> dict[str, object]:
    return {
        "eventId": task_event.event_id,
        "workspaceId": str(task_event.workspace_id),
        "runId": str(task_event.run_id),
        "taskId": str(task_event.task_id),
        "taskRevision": task_event.task_revision,
        "attemptId": str(task_event.attempt_id),
        "attemptNumber": task_event.attempt_number,
        "source": task_event.source,
        "sourceEventId": task_event.source_event_id,
        "sequence": task_event.sequence,
    }


async def test_publisher_acknowledges_exact_spring_batch_response() -> None:
    observed: dict[str, object] = {}
    task_event = event()

    def handler(request: httpx.Request) -> httpx.Response:
        observed.update(__import__("json").loads(request.content))
        assert request.headers["Authorization"] == "Bearer workload-token"
        return httpx.Response(200, json={"acknowledgements": [acknowledgement(task_event)]})

    store = InMemoryTaskAttemptEventStore()
    await store.append(task_event)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://backend:8080") as http_client:
        publisher = TaskEventPublisher(store, SpringTaskEventClient("http://backend:8080", client=http_client))
        assert await publisher.publish_once("workload-token", workspace_id=task_event.workspace_id, run_id=task_event.run_id) == 1  # noqa: E501
        assert await publisher.publish_once("workload-token", workspace_id=task_event.workspace_id, run_id=task_event.run_id) == 0  # noqa: E501

    payload = observed["events"]
    assert isinstance(payload, list)
    assert payload[0]["taskRevision"] == 2
    assert payload[0]["phase"] == "research"


async def test_publisher_rejects_acknowledgement_with_different_revision() -> None:
    task_event = event()
    invalid = acknowledgement(task_event)
    invalid["taskRevision"] = task_event.task_revision + 1
    store = InMemoryTaskAttemptEventStore()
    await store.append(task_event)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"acknowledgements": [invalid]})),
        base_url="http://backend:8080"
    ) as http_client:
        publisher = TaskEventPublisher(store, SpringTaskEventClient("http://backend:8080", client=http_client))
        with pytest.raises(SpringTaskEventError, match="RESPONSE_INVALID"):
            await publisher.publish_once("workload-token", workspace_id=task_event.workspace_id, run_id=task_event.run_id)  # noqa: E501


async def test_publisher_releases_claim_for_retry_after_failure() -> None:
    store = InMemoryTaskAttemptEventStore()
    task_event = event()
    await store.append(task_event)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(503)), base_url="http://backend:8080"
    ) as http_client:
        publisher = TaskEventPublisher(store, SpringTaskEventClient("http://backend:8080", client=http_client))
        with pytest.raises(SpringTaskEventError, match="UNAVAILABLE"):
            await publisher.publish_once("workload-token", workspace_id=task_event.workspace_id, run_id=task_event.run_id)  # noqa: E501

    assert await store.claim_for_delivery(workspace_id=task_event.workspace_id, run_id=task_event.run_id) == []


@pytest.mark.parametrize("same_workspace", [True, False])
async def test_publisher_does_not_claim_another_workload(same_workspace: bool) -> None:
    selected = event()
    other = replace(event(), event_id="other-event", source_event_id="other-source", workspace_id=selected.workspace_id if same_workspace else uuid4(), run_id=uuid4() if same_workspace else selected.run_id)  # noqa: E501
    store = InMemoryTaskAttemptEventStore()
    await store.append(other)
    await store.append(selected)

    def handler(request: httpx.Request) -> httpx.Response:
        assert [item["eventId"] for item in json.loads(request.content)["events"]] == [selected.event_id]
        return httpx.Response(200, json={"acknowledgements": [acknowledgement(selected)]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://backend:8080") as http_client:
        publisher = TaskEventPublisher(store, SpringTaskEventClient("http://backend:8080", client=http_client))
        assert await publisher.publish_once("workload-token", workspace_id=selected.workspace_id, run_id=selected.run_id, batch_size=1) == 1  # noqa: E501
    remaining = await store.claim_for_delivery(workspace_id=other.workspace_id, run_id=other.run_id)
    assert [(claim.record.event_id, claim.delivery_attempt) for claim in remaining] == [(other.event_id, 1)]


async def test_missing_token_does_not_lease_events() -> None:
    selected = event()
    store = InMemoryTaskAttemptEventStore()
    await store.append(selected)
    publisher = TaskEventPublisher(store, SpringTaskEventClient("http://backend:8080"))

    with pytest.raises(SpringTaskEventError, match="AUTHORIZATION_REQUIRED"):
        await publisher.publish_once(" ", workspace_id=selected.workspace_id, run_id=selected.run_id)

    claims = await store.claim_for_delivery(workspace_id=selected.workspace_id, run_id=selected.run_id)
    assert [(claim.record.event_id, claim.delivery_attempt) for claim in claims] == [(selected.event_id, 1)]


async def test_publisher_rejects_incorrect_store_scope_before_network_send() -> None:
    selected = event()

    class IncorrectScopeStore(InMemoryTaskAttemptEventStore):
        async def claim_for_delivery(self, **options):
            return await super().claim_for_delivery(workspace_id=selected.workspace_id, run_id=selected.run_id)

    store = IncorrectScopeStore()
    await store.append(selected)

    def handler(request: httpx.Request) -> httpx.Response:
        pytest.fail("A mismatched event must never be sent")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://backend:8080") as http_client:
        publisher = TaskEventPublisher(store, SpringTaskEventClient("http://backend:8080", client=http_client))
        with pytest.raises(SpringTaskEventError, match="SCOPE_MISMATCH"):
            await publisher.publish_once("workload-token", workspace_id=uuid4(), run_id=uuid4())
