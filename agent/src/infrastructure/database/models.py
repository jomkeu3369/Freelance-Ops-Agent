"""SQLAlchemy ORM entities owned by the Agent runtime schema."""

# ruff: noqa: E501, I001

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Float, ForeignKeyConstraint, Index, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class AgentRuntimeBase(DeclarativeBase):
    """Base metadata restricted to the Agent-owned PostgreSQL schema."""


class AgentRunStateModel(AgentRuntimeBase):
    __tablename__ = "agent_run_state"
    __table_args__ = (
        Index("ix_agent_run_state_status_updated_at", "status", "updated_at"),
        {"schema": "agent_runtime"},
    )

    run_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    request_json: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(32), index=True)
    active_department: Mapped[str | None] = mapped_column(String(32))
    interruption_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    usage_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error_code: Mapped[str | None] = mapped_column(String(100))
    idempotency_keys: Mapped[list[str]] = mapped_column(JSONB, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AgentRunEventModel(AgentRuntimeBase):
    __tablename__ = "agent_run_event"
    __table_args__ = (
        ForeignKeyConstraint(
            ["run_id"],
            ["agent_runtime.agent_run_state.run_id"],
            ondelete="CASCADE",
        ),
        Index("ix_agent_run_event_run_occurred", "run_id", "occurred_at"),
        {"schema": "agent_runtime"},
    )

    run_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    event_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    type: Mapped[str] = mapped_column(String(100))
    data_json: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AgentTaskEventModel(AgentRuntimeBase):
    __tablename__ = "agent_task_event"
    __table_args__ = (
        ForeignKeyConstraint(["run_id"], ["agent_runtime.agent_run_state.run_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["task_id", "task_revision"], ["agent_runtime.agent_task.task_id", "agent_runtime.agent_task.revision"], ondelete="CASCADE"),
        ForeignKeyConstraint(["attempt_id"], ["agent_runtime.agent_task_attempt.attempt_id"], ondelete="CASCADE"),
        UniqueConstraint("source", "source_event_id", name="uq_agent_task_event_source"),
        UniqueConstraint("attempt_id", "sequence", name="uq_agent_task_event_attempt_sequence"),
        Index("ix_agent_task_event_run_received", "run_id", "received_at", "event_id"),
        Index("ix_agent_task_event_attempt_occurred", "attempt_id", "occurred_at"),
        Index("ix_agent_task_event_delivery", "delivery_status", "delivery_available_at", "delivery_lease_until", "received_at"),
        {"schema": "agent_runtime"}
    )

    event_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    run_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    schema_version: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    source_event_id: Mapped[str] = mapped_column(String(128), nullable=False)
    task_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    task_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    attempt_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    phase: Mapped[str | None] = mapped_column(String(100))
    milestone: Mapped[str | None] = mapped_column(String(200))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    data_json: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    delivery_status: Mapped[str] = mapped_column(String(20), default="PENDING", nullable=False)
    delivery_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    delivery_available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    delivery_lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivery_last_error: Mapped[str | None] = mapped_column(String(500))


class AgentTaskModel(AgentRuntimeBase):
    __tablename__ = "agent_task"
    __table_args__ = (
        ForeignKeyConstraint(["run_id"], ["agent_runtime.agent_run_state.run_id"], ondelete="CASCADE"),
        CheckConstraint("revision >= 1", name="ck_agent_task_revision"),
        CheckConstraint("priority BETWEEN 1 AND 5", name="ck_agent_task_priority"),
        CheckConstraint("status IN ('SUBMITTED','ADMITTED','DEFERRED','QUEUED','RUNNING','CHECKPOINTED','PAUSED','RETRY_WAIT','WAITING_FOR_CAPACITY','COMPLETED','FAILED','CANCELLED','REJECTED','SUPERSEDED')", name="ck_agent_task_status"),
        Index("ix_agent_task_workspace_status_priority", "workspace_id", "status", "priority", "created_at"),
        Index("ix_agent_task_run_status", "run_id", "status"),
        {"schema": "agent_runtime"}
    )

    task_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    department: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False)
    dependency_task_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    execution_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    schema_version: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AgentTaskAttemptModel(AgentRuntimeBase):
    __tablename__ = "agent_task_attempt"
    __table_args__ = (
        ForeignKeyConstraint(["run_id"], ["agent_runtime.agent_run_state.run_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["task_id", "task_revision"], ["agent_runtime.agent_task.task_id", "agent_runtime.agent_task.revision"], ondelete="CASCADE"),
        UniqueConstraint("task_id", "task_revision", "attempt_number", name="uq_agent_task_attempt_number"),
        CheckConstraint("attempt_number >= 1", name="ck_agent_task_attempt_number"),
        CheckConstraint("status IN ('PREDICTED','QUEUED','RUNNING','CHECKPOINTED','COMPLETED','FAILED','CANCELLED','SUPERSEDED')", name="ck_agent_task_attempt_status"),
        CheckConstraint("predicted_service_runtime_seconds IS NULL OR predicted_service_runtime_seconds >= 0", name="ck_agent_task_attempt_prediction_nonnegative"),
        CheckConstraint("(predicted_service_runtime_seconds IS NULL AND predictor_version IS NULL) OR (predicted_service_runtime_seconds IS NOT NULL AND predictor_version IS NOT NULL)", name="ck_agent_task_attempt_prediction_pair"),
        CheckConstraint("(queued_at IS NULL OR started_at IS NULL OR queued_at <= started_at) AND (started_at IS NULL OR finished_at IS NULL OR started_at <= finished_at)", name="ck_agent_task_attempt_time_order"),
        CheckConstraint("(checkpoint_id IS NULL AND checkpoint_artifact_reference IS NULL AND resume_token_hash IS NULL) OR (checkpoint_id IS NOT NULL AND checkpoint_artifact_reference IS NOT NULL AND resume_token_hash IS NOT NULL)", name="ck_agent_task_attempt_checkpoint_pair"),
        CheckConstraint("checkpoint_restored_seconds >= 0", name="ck_agent_task_attempt_checkpoint_restored"),
        CheckConstraint("classification_confidence IS NULL OR classification_confidence BETWEEN 0 AND 1", name="ck_agent_task_attempt_classification_confidence"),
        CheckConstraint("retry_decision IS NULL OR retry_decision IN ('ALLOW','DENY')", name="ck_agent_task_attempt_retry_decision"),
        Index("ix_agent_task_attempt_workspace_status", "workspace_id", "status", "created_at"),
        Index("ix_agent_task_attempt_task_status", "task_id", "task_revision", "status"),
        {"schema": "agent_runtime"}
    )

    attempt_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    task_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    task_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    run_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    predicted_service_runtime_seconds: Mapped[float | None] = mapped_column(Float)
    predictor_version: Mapped[str | None] = mapped_column(String(100))
    queued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    checkpoint_id: Mapped[str | None] = mapped_column(String(128))
    checkpoint_artifact_reference: Mapped[str | None] = mapped_column(String(500))
    resume_token_hash: Mapped[str | None] = mapped_column(String(64))
    checkpoint_restored_seconds: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    completed_steps: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    side_effect_idempotency_keys: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    failure_classification: Mapped[str | None] = mapped_column(String(40))
    classification_confidence: Mapped[float | None] = mapped_column(Float)
    classifier_version: Mapped[str | None] = mapped_column(String(100))
    retry_decision: Mapped[str | None] = mapped_column(String(20))
    retry_reason: Mapped[str | None] = mapped_column(String(80))
    retry_ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retry_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    schema_version: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AgentRetryBucketModel(AgentRuntimeBase):
    __tablename__ = "agent_retry_bucket"
    __table_args__ = (
        CheckConstraint("scope_type IN ('GLOBAL','WORKSPACE')", name="ck_agent_retry_bucket_scope_type"),
        CheckConstraint("capacity > 0 AND tokens >= 0 AND tokens <= capacity AND refill_per_second >= 0", name="ck_agent_retry_bucket_values"),
        CheckConstraint("(scope_type = 'GLOBAL' AND workspace_id IS NULL) OR (scope_type = 'WORKSPACE' AND workspace_id IS NOT NULL)", name="ck_agent_retry_bucket_scope"),
        UniqueConstraint("workspace_id", name="uq_agent_retry_bucket_workspace"),
        {"schema": "agent_runtime"}
    )

    bucket_key: Mapped[str] = mapped_column(String(200), primary_key=True)
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False)
    workspace_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True))
    capacity: Mapped[float] = mapped_column(Float, nullable=False)
    tokens: Mapped[float] = mapped_column(Float, nullable=False)
    refill_per_second: Mapped[float] = mapped_column(Float, nullable=False)
    refilled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(100), nullable=False)


class AgentProviderCircuitModel(AgentRuntimeBase):
    __tablename__ = "agent_provider_circuit"
    __table_args__ = (
        UniqueConstraint("provider", "model", name="uq_agent_provider_circuit_identity"),
        CheckConstraint("state IN ('CLOSED','OPEN','HALF_OPEN')", name="ck_agent_provider_circuit_state"),
        CheckConstraint("(state = 'CLOSED' AND opened_at IS NULL AND probe_after IS NULL) OR (state IN ('OPEN','HALF_OPEN') AND opened_at IS NOT NULL AND probe_after IS NOT NULL)", name="ck_agent_provider_circuit_open"),
        {"schema": "agent_runtime"}
    )

    circuit_key: Mapped[str] = mapped_column(String(200), primary_key=True)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    state: Mapped[str] = mapped_column(String(20), nullable=False)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    probe_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    policy_version: Mapped[str] = mapped_column(String(100), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AgentSchedulerEntryModel(AgentRuntimeBase):
    __tablename__ = "agent_scheduler_entry"
    __table_args__ = (
        ForeignKeyConstraint(["attempt_id"], ["agent_runtime.agent_task_attempt.attempt_id"], ondelete="CASCADE"),
        CheckConstraint("queue_kind IN ('READY','RETRY')", name="ck_agent_scheduler_entry_kind"),
        CheckConstraint("entry_status IN ('PENDING','CLAIMED','DISPATCHED','CANCELLED','FINISHED')", name="ck_agent_scheduler_entry_status"),
        CheckConstraint("priority BETWEEN 1 AND 5 AND predicted_runtime_seconds >= 0", name="ck_agent_scheduler_entry_values"),
        CheckConstraint("available_at >= enqueued_at", name="ck_agent_scheduler_entry_available"),
        CheckConstraint("shadow_decision IN ('ADMIT','DEFER','REJECT')", name="ck_agent_scheduler_entry_shadow_decision"),
        CheckConstraint("(entry_status IN ('CLAIMED','DISPATCHED') AND claim_id IS NOT NULL AND claimed_by IS NOT NULL AND lease_until IS NOT NULL) OR (entry_status NOT IN ('CLAIMED','DISPATCHED') AND claim_id IS NULL AND claimed_by IS NULL AND lease_until IS NULL)", name="ck_agent_scheduler_entry_claim"),
        Index("ix_agent_scheduler_entry_pending", "resource_pool", "entry_status", "available_at", "enqueued_at"),
        Index("ix_agent_scheduler_entry_workspace_pending", "resource_pool", "workspace_id", "entry_status", "available_at"),
        {"schema": "agent_runtime"}
    )

    attempt_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    task_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    task_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    resource_pool: Mapped[str] = mapped_column(String(100), nullable=False)
    queue_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    entry_status: Mapped[str] = mapped_column(String(20), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False)
    predicted_runtime_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    predictor_version: Mapped[str] = mapped_column(String(100), nullable=False)
    enqueued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actual_policy_version: Mapped[str] = mapped_column(String(100), nullable=False)
    shadow_policy_version: Mapped[str] = mapped_column(String(100), nullable=False)
    shadow_decision: Mapped[str] = mapped_column(String(20), nullable=False)
    shadow_reason: Mapped[str] = mapped_column(String(80), nullable=False)
    shadow_available_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    admission_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    last_actual_rank: Mapped[int | None] = mapped_column(Integer)
    last_shadow_rank: Mapped[int | None] = mapped_column(Integer)
    last_shadow_score: Mapped[float | None] = mapped_column(Float)
    last_shadow_lane: Mapped[str | None] = mapped_column(String(40))
    claim_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True))
    claimed_by: Mapped[str | None] = mapped_column(String(100))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AgentResearchPoolModel(AgentRuntimeBase):
    __tablename__ = "agent_research_pool"
    __table_args__ = (CheckConstraint("worker_count >= 1", name="ck_research_pool_capacity"), {"schema": "agent_runtime"})

    resource_pool: Mapped[str] = mapped_column(String(100), primary_key=True)
    worker_count: Mapped[int] = mapped_column(Integer, nullable=False)


class AgentResearchBudgetModel(AgentRuntimeBase):
    __tablename__ = "agent_research_budget"
    __table_args__ = (
        ForeignKeyConstraint(["run_id"], ["agent_runtime.agent_run_state.run_id"], ondelete="CASCADE"),
        CheckConstraint("primary_status IN ('RESERVED','COMPLETED','UNKNOWN')", name="ck_research_budget_primary_status"),
        CheckConstraint("shadow_status IN ('DISABLED','RESERVED','RUNNING','COMPLETED','UNKNOWN')", name="ck_research_budget_shadow_status"),
        {"schema": "agent_runtime"}
    )

    run_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    input_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    original_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    primary_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    shadow_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    primary_status: Mapped[str] = mapped_column(String(20), nullable=False)
    primary_usage_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    shadow_status: Mapped[str] = mapped_column(String(20), nullable=False)
    shadow_usage_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AgentWorkerCapacityEventModel(AgentRuntimeBase):
    __tablename__ = "agent_worker_capacity_event"
    __table_args__ = (
        CheckConstraint("worker_count >= 1", name="ck_agent_worker_capacity_event_count"),
        Index("ix_agent_worker_capacity_event_pool_time", "resource_pool", "captured_at"),
        {"schema": "agent_runtime"}
    )

    event_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    resource_pool: Mapped[str] = mapped_column(String(100), nullable=False)
    worker_count: Mapped[int] = mapped_column(Integer, nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(String(100), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(100), nullable=False)


class AgentRuntimeReleaseModel(AgentRuntimeBase):
    __tablename__ = "agent_runtime_release"
    __table_args__ = (
        UniqueConstraint("release_kind", "version", "resource_pool", name="uq_agent_runtime_release_version"),
        CheckConstraint("release_kind IN ('RUNTIME_PREDICTOR','SCHEDULER_POLICY')", name="ck_agent_runtime_release_kind"),
        CheckConstraint("status IN ('SHADOW_ONLY','APPROVED','REJECTED')", name="ck_agent_runtime_release_status"),
        CheckConstraint("artifact_sha256 ~ '^[0-9a-f]{64}$' AND dataset_fingerprint ~ '^[0-9a-f]{64}$'", name="ck_agent_runtime_release_hashes"),
        CheckConstraint("(status = 'APPROVED' AND approved_at IS NOT NULL) OR (status <> 'APPROVED' AND approved_at IS NULL)", name="ck_agent_runtime_release_approved"),
        Index("ix_agent_runtime_release_pool_status", "resource_pool", "release_kind", "status", "created_at"),
        {"schema": "agent_runtime"}
    )

    release_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    release_kind: Mapped[str] = mapped_column(String(30), nullable=False)
    version: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_pool: Mapped[str] = mapped_column(String(100), nullable=False)
    artifact_reference: Mapped[str] = mapped_column(String(500), nullable=False)
    artifact_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    dataset_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    report_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    policy_version: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AgentTaskCommandReceiptModel(AgentRuntimeBase):
    __tablename__ = "agent_task_command_receipt"
    __table_args__ = (
        ForeignKeyConstraint(["run_id"], ["agent_runtime.agent_run_state.run_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["task_id", "task_revision"], ["agent_runtime.agent_task.task_id", "agent_runtime.agent_task.revision"], ondelete="CASCADE"),
        CheckConstraint("status IN ('PENDING','APPLIED','REJECTED')", name="ck_agent_task_command_receipt_status"),
        CheckConstraint("task_revision >= 1 AND authorization_revision >= 1 AND budget_revision >= 1", name="ck_agent_task_command_receipt_revision"),
        CheckConstraint("(status = 'APPLIED' AND applied_at IS NOT NULL) OR (status <> 'APPLIED' AND applied_at IS NULL)", name="ck_agent_task_command_receipt_applied"),
        Index("ix_agent_task_command_receipt_pending", "status", "received_at"),
        {"schema": "agent_runtime"}
    )

    command_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    task_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    task_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    run_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    attempt_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True))
    command_type: Mapped[str] = mapped_column(String(30), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    requested_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    authorization_revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    budget_revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    payload_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PgExtensionModel(AgentRuntimeBase):
    """Read-only catalog mapping used by the internal database health check."""

    __tablename__ = "pg_extension"
    __table_args__ = {"schema": "pg_catalog"}

    oid: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    extname: Mapped[str] = mapped_column(Text)
    extversion: Mapped[str] = mapped_column(Text)
