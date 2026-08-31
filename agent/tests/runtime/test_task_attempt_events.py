# ruff: noqa: I001

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from runtime.task_attempt_events import InMemoryTaskAttemptEventStore, TaskAttemptEventConflictError, TaskAttemptEventCursor, TaskAttemptEventWrite  # noqa: E501, I001


def make_event(*, event_id: str = "event-1", source_event_id: str = "source-1", attempt_id=None, sequence: int = 1, data: dict[str, object] | None = None, run_id=None) -> TaskAttemptEventWrite:  # noqa: ANN001, E501
    return TaskAttemptEventWrite(event_id=event_id, run_id=uuid4() if run_id is None else run_id, source="worker", source_event_id=source_event_id, task_id=uuid4(), task_revision=1, attempt_id=uuid4() if attempt_id is None else attempt_id, attempt_number=1, workspace_id=uuid4(), sequence=sequence, event_type="attempt.queued", occurred_at=datetime.now(UTC), data={} if data is None else data)  # noqa: E501


async def test_append_is_exactly_idempotent() -> None:
    store = InMemoryTaskAttemptEventStore()
    event = make_event()

    first = await store.append(event)
    second = await store.append(event)

    assert first == second


async def test_append_rejects_changed_event_with_same_source_key() -> None:
    store = InMemoryTaskAttemptEventStore()
    event = make_event()
    await store.append(event)
    changed = TaskAttemptEventWrite(event_id=event.event_id, run_id=event.run_id, source=event.source, source_event_id=event.source_event_id, task_id=event.task_id, task_revision=event.task_revision, attempt_id=event.attempt_id, attempt_number=event.attempt_number, workspace_id=event.workspace_id, sequence=event.sequence, event_type=event.event_type, occurred_at=event.occurred_at, data={"status": "changed"})  # noqa: E501

    with pytest.raises(TaskAttemptEventConflictError):
        await store.append(changed)


async def test_append_rejects_attempt_sequence_collision() -> None:
    store = InMemoryTaskAttemptEventStore()
    first = make_event()
    await store.append(first)
    collision = TaskAttemptEventWrite(event_id="event-2", run_id=first.run_id, source="worker", source_event_id="source-2", task_id=first.task_id, task_revision=first.task_revision, attempt_id=first.attempt_id, attempt_number=1, workspace_id=first.workspace_id, sequence=first.sequence, event_type=first.event_type, occurred_at=first.occurred_at, data={})  # noqa: E501

    with pytest.raises(TaskAttemptEventConflictError):
        await store.append(collision)


async def test_list_for_run_supports_cursor_and_run_isolation() -> None:
    store = InMemoryTaskAttemptEventStore()
    run_id = uuid4()
    first = await store.append(make_event(run_id=run_id))
    await store.append(make_event(event_id="event-2", source_event_id="source-2", run_id=run_id))  # noqa: E501
    await store.append(make_event(event_id="other-event", source_event_id="other-source"))

    page = await store.list_for_run(run_id, after=TaskAttemptEventCursor(received_at=first.received_at, event_id=first.event_id))  # noqa: E501

    assert [record.event_id for record in page] == ["event-2"]


@pytest.mark.parametrize("data", [{"secret": "value"}, {"nested": {"api_key": "value"}}, {"items": [{"chain_of_thought": "value"}]}])  # noqa: E501
def test_event_rejects_forbidden_fields(data: dict[str, object]) -> None:
    with pytest.raises(ValueError, match="forbidden"):
        make_event(data=data)


def test_event_rejects_naive_timestamp() -> None:
    event = make_event()

    with pytest.raises(ValueError, match="timezone-aware"):
        TaskAttemptEventWrite(event_id=event.event_id, run_id=event.run_id, source=event.source, source_event_id=event.source_event_id, task_id=event.task_id, task_revision=event.task_revision, attempt_id=event.attempt_id, attempt_number=event.attempt_number, workspace_id=event.workspace_id, sequence=event.sequence, event_type=event.event_type, occurred_at=datetime.now(), data={})  # noqa: DTZ005, E501


def test_cursor_rejects_naive_timestamp() -> None:
    with pytest.raises(ValueError, match="invalid"):
        TaskAttemptEventCursor(received_at=datetime.now() - timedelta(seconds=1), event_id="event-1")  # noqa: DTZ005
