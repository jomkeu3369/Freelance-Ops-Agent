from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock

import pytest

import runtime
from infrastructure.database import PgVectorConnectionManager


def test_async_runtime_services_are_composed_from_one_database_boundary() -> None:
    database = cast(PgVectorConnectionManager, object())

    services = runtime.build_async_runtime_services(database)

    assert isinstance(services.task_registry, runtime.PostgresTaskRegistry)
    assert isinstance(services.task_command_inbox, runtime.PostgresTaskCommandInbox)
    assert isinstance(services.task_event_store, runtime.PostgresTaskAttemptEventStore)
    assert isinstance(services.task_reliability_store, runtime.PostgresTaskReliabilityStore)
    assert isinstance(services.scheduler_store, runtime.PostgresShadowSchedulerStore)
    assert isinstance(services.evaluation_store, runtime.PostgresRuntimeEvaluationStore)
    assert isinstance(services.operational_metrics, runtime.PostgresRuntimeOperationalMetrics)


async def test_lifespan_checks_readiness_before_starting_dispatcher(monkeypatch: pytest.MonkeyPatch) -> None:
    import main

    sink = SimpleNamespace(start=Mock(), close=AsyncMock(), recover=AsyncMock())
    services = SimpleNamespace(task_registry=SimpleNamespace(initialize=AsyncMock()), task_event_store=SimpleNamespace(initialize=AsyncMock()), operational_metrics=SimpleNamespace(snapshot=AsyncMock(return_value=object())))  # noqa: E501
    app = SimpleNamespace(state=SimpleNamespace(database_manager=None, postgres_run_store=None, checkpoint_journal=None, async_runtime_services=services, research_worker_sink=sink))  # noqa: E501
    validation = Mock(side_effect=ValueError("readiness rejected"))
    monkeypatch.setattr(main, "require_pilot_activation", validation)

    with pytest.raises(ValueError, match="readiness rejected"):
        async with main.lifespan(app):  # type: ignore[arg-type]
            pytest.fail("unapproved pilot must not serve requests")

    validation.assert_called_once()
    sink.recover.assert_awaited_once()
    sink.start.assert_not_called()
    sink.close.assert_awaited_once()
