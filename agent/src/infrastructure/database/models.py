"""SQLAlchemy ORM entities owned by the Agent runtime schema."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, DateTime, ForeignKeyConstraint, Index, Integer, String, Text, UniqueConstraint, Uuid
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
        UniqueConstraint("source", "source_event_id", name="uq_agent_task_event_source"),
        UniqueConstraint("attempt_id", "sequence", name="uq_agent_task_event_attempt_sequence"),
        Index("ix_agent_task_event_run_received", "run_id", "received_at", "event_id"),
        Index("ix_agent_task_event_attempt_occurred", "attempt_id", "occurred_at"),
        {"schema": "agent_runtime"}
    )

    event_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    run_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    schema_version: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    source_event_id: Mapped[str] = mapped_column(String(128), nullable=False)
    task_id: Mapped[str] = mapped_column(String(128), nullable=False)
    attempt_id: Mapped[str] = mapped_column(String(128), nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    data_json: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class PgExtensionModel(AgentRuntimeBase):
    """Read-only catalog mapping used by the internal database health check."""

    __tablename__ = "pg_extension"
    __table_args__ = {"schema": "pg_catalog"}

    oid: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    extname: Mapped[str] = mapped_column(Text)
    extversion: Mapped[str] = mapped_column(Text)
