from typing import cast

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
