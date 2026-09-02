"""Composition boundary for PostgreSQL-backed asynchronous runtime services."""

from __future__ import annotations

from dataclasses import dataclass

from infrastructure.database import PgVectorConnectionManager

from .runtime_evaluation_store import PostgresRuntimeEvaluationStore
from .runtime_operational_metrics import PostgresRuntimeOperationalMetrics
from .task_attempt_events import PostgresTaskAttemptEventStore
from .task_commands import PostgresTaskCommandInbox
from .task_registry import PostgresTaskRegistry
from .task_reliability_store import PostgresTaskReliabilityStore
from .task_scheduler_store import PostgresShadowSchedulerStore


@dataclass(frozen=True, slots=True)
class AsyncRuntimeServices:
    task_registry: PostgresTaskRegistry
    task_command_inbox: PostgresTaskCommandInbox
    task_event_store: PostgresTaskAttemptEventStore
    task_reliability_store: PostgresTaskReliabilityStore
    scheduler_store: PostgresShadowSchedulerStore
    evaluation_store: PostgresRuntimeEvaluationStore
    operational_metrics: PostgresRuntimeOperationalMetrics


def build_async_runtime_services(database: PgVectorConnectionManager) -> AsyncRuntimeServices:
    return AsyncRuntimeServices(
        task_registry=PostgresTaskRegistry(database),
        task_command_inbox=PostgresTaskCommandInbox(database),
        task_event_store=PostgresTaskAttemptEventStore(database),
        task_reliability_store=PostgresTaskReliabilityStore(database),
        scheduler_store=PostgresShadowSchedulerStore(database),
        evaluation_store=PostgresRuntimeEvaluationStore(database),
        operational_metrics=PostgresRuntimeOperationalMetrics(database)
    )
