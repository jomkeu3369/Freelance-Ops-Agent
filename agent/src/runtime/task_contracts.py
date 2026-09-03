"""Versioned contracts and state transitions for durable asynchronous tasks."""

# ruff: noqa: E501

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import ConfigDict, Field, field_validator, model_validator

from contracts import DepartmentName, ModelSelection, RunBudget, StrictModel
from routing.profiles import ExecutionRisk, ToolProfile

TASK_CONTRACT_SCHEMA_VERSION = "async-task-contract-v1"
FORBIDDEN_RUNTIME_DATA_KEYS = frozenset(("api_key", "chain_of_thought", "delegation_token", "prompt", "resume_token", "secret"))


class TaskContractError(RuntimeError):
    pass

class TaskTransitionError(TaskContractError):
    pass

class TaskRevisionConflictError(TaskContractError):
    pass

class TaskScopeError(TaskContractError):
    pass

class ExecutionRoute(StrEnum):
    DIRECT_TOOL = "DIRECT_TOOL"
    SIMPLE_LLM = "SIMPLE_LLM"
    REACT_AGENT = "REACT_AGENT"
    SUPERVISOR = "SUPERVISOR"
    HUMAN_REQUIRED = "HUMAN_REQUIRED"

class TaskStatus(StrEnum):
    SUBMITTED = "SUBMITTED"
    ADMITTED = "ADMITTED"
    DEFERRED = "DEFERRED"
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    CHECKPOINTED = "CHECKPOINTED"
    PAUSED = "PAUSED"
    RETRY_WAIT = "RETRY_WAIT"
    WAITING_FOR_CAPACITY = "WAITING_FOR_CAPACITY"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"
    SUPERSEDED = "SUPERSEDED"

class AttemptStatus(StrEnum):
    PREDICTED = "PREDICTED"
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    CHECKPOINTED = "CHECKPOINTED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    SUPERSEDED = "SUPERSEDED"

class TaskCommandType(StrEnum):
    PAUSE = "PAUSE"
    RESUME = "RESUME"
    SOFT_UPDATE = "SOFT_UPDATE"
    HARD_REDIRECT = "HARD_REDIRECT"
    CANCEL = "CANCEL"

class TaskCommandStatus(StrEnum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    APPLIED = "APPLIED"
    REJECTED = "REJECTED"
    SUPERSEDED = "SUPERSEDED"


class FailureClassification(StrEnum):
    INDEPENDENT_TRANSIENT = "INDEPENDENT_TRANSIENT"
    CORRELATED_PROVIDER = "CORRELATED_PROVIDER"
    DETERMINISTIC = "DETERMINISTIC"


class RetryDecision(StrEnum):
    ALLOW = "ALLOW"
    DENY = "DENY"


class RetryReason(StrEnum):
    RETRY_ALLOWED = "RETRY_ALLOWED"
    NON_RETRYABLE_FAILURE = "NON_RETRYABLE_FAILURE"
    WORKSPACE_BUCKET_EMPTY = "WORKSPACE_BUCKET_EMPTY"
    GLOBAL_BUCKET_EMPTY = "GLOBAL_BUCKET_EMPTY"
    MAX_ATTEMPTS_REACHED = "MAX_ATTEMPTS_REACHED"
    CORRELATED_FAILURE_CIRCUIT_OPEN = "CORRELATED_FAILURE_CIRCUIT_OPEN"

class RuntimeContractModel(StrictModel):
    model_config = ConfigDict(frozen=True)

class TaskExecutionSnapshot(RuntimeContractModel):
    route: ExecutionRoute
    permissions: list[str] = Field(max_length=100)
    budget: RunBudget
    model_selection: ModelSelection
    policy_version: str = Field(min_length=1, max_length=100)
    prompt_version: str = Field(min_length=1, max_length=100)
    tool_schema_version: str = Field(min_length=1, max_length=100)
    risk_level: ExecutionRisk = ExecutionRisk.LOW
    tool_profile: ToolProfile = ToolProfile.READ_ONLY
    model_profile: str = Field(default="react-read-v1", min_length=1, max_length=100)
    route_profile_version: str = Field(default="route-profile-v1", min_length=1, max_length=100)
    guard_policy_version: str = Field(default="task-guard-v1", min_length=1, max_length=100)
    specialist_profile: str = Field(default="default-v1", min_length=1, max_length=100)
    authorization_revision: int = Field(default=1, ge=1)
    budget_revision: int = Field(default=1, ge=1)
    input_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, permissions: list[str]) -> list[str]:
        if any(not permission.strip() for permission in permissions):
            raise ValueError("permission snapshot entries must not be blank")
        if len(permissions) != len(set(permissions)):
            raise ValueError("permission snapshot entries must be unique")
        return permissions

class DepartmentTask(RuntimeContractModel):
    task_id: UUID
    run_id: UUID
    workspace_id: UUID
    project_id: UUID
    department: DepartmentName
    revision: int = Field(ge=1)
    status: TaskStatus = TaskStatus.SUBMITTED
    priority: int = Field(default=3, ge=1, le=5)
    dependency_task_ids: list[UUID] = Field(default_factory=list, max_length=100)
    execution: TaskExecutionSnapshot
    created_at: datetime
    schema_version: str = TASK_CONTRACT_SCHEMA_VERSION

    @field_validator("created_at")
    @classmethod
    def validate_created_at(cls, value: datetime) -> datetime:
        return _require_timezone(value, "task created_at")

    @model_validator(mode="after")
    def validate_dependencies(self) -> DepartmentTask:
        if self.task_id in self.dependency_task_ids:
            raise ValueError("task cannot depend on itself")

        if len(self.dependency_task_ids) != len(set(self.dependency_task_ids)):
            raise ValueError("task dependencies must be unique")

        if self.schema_version != TASK_CONTRACT_SCHEMA_VERSION:
            raise ValueError("task contract schema version is unsupported")
        return self

class TaskAttempt(RuntimeContractModel):
    attempt_id: UUID
    task_id: UUID
    run_id: UUID
    workspace_id: UUID
    task_revision: int = Field(ge=1)
    attempt_number: int = Field(ge=1)
    status: AttemptStatus = AttemptStatus.PREDICTED
    predicted_service_runtime_seconds: float | None = Field(default=None, ge=0)
    predictor_version: str | None = Field(default=None, min_length=1, max_length=100)
    queued_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    checkpoint_id: str | None = Field(default=None, min_length=1, max_length=128)
    checkpoint_artifact_reference: str | None = Field(default=None, min_length=1, max_length=500)
    resume_token_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    checkpoint_restored_seconds: float = Field(default=0, ge=0)
    completed_steps: list[str] = Field(default_factory=list, max_length=200)
    side_effect_idempotency_keys: list[str] = Field(default_factory=list, max_length=500)
    schema_version: str = TASK_CONTRACT_SCHEMA_VERSION

    @field_validator("queued_at", "started_at", "finished_at")
    @classmethod
    def validate_timestamp(cls, value: datetime | None) -> datetime | None:
        return None if value is None else _require_timezone(value, "attempt timestamp")

    @model_validator(mode="after")
    def validate_attempt(self) -> TaskAttempt:
        if (self.predicted_service_runtime_seconds is None) != (self.predictor_version is None):
            raise ValueError("runtime prediction and predictor version must be recorded together")
        ordered = [value for value in (self.queued_at, self.started_at, self.finished_at) if value is not None]
        if ordered != sorted(ordered):
            raise ValueError("attempt timestamps must be monotonic")
        checkpoint_parts = (self.checkpoint_id, self.checkpoint_artifact_reference, self.resume_token_hash)
        if any(value is None for value in checkpoint_parts) != all(value is None for value in checkpoint_parts):
            raise ValueError("checkpoint identity, artifact reference, and resume token hash must be recorded together")
        if len(self.completed_steps) != len(set(self.completed_steps)) or len(self.side_effect_idempotency_keys) != len(set(self.side_effect_idempotency_keys)):
            raise ValueError("checkpoint steps and side effect keys must be unique")
        if self.schema_version != TASK_CONTRACT_SCHEMA_VERSION:
            raise ValueError("task contract schema version is unsupported")
        return self


class TaskCheckpoint(RuntimeContractModel):
    checkpoint_id: str = Field(min_length=1, max_length=128)
    artifact_reference: str = Field(min_length=1, max_length=500)
    resume_token_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    completed_steps: list[str] = Field(default_factory=list, max_length=200)
    side_effect_idempotency_keys: list[str] = Field(default_factory=list, max_length=500)
    durable_progress_seconds: float = Field(ge=0)
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def validate_created_at(cls, value: datetime) -> datetime:
        return _require_timezone(value, "checkpoint created_at")

    @model_validator(mode="after")
    def validate_checkpoint(self) -> TaskCheckpoint:
        if len(self.completed_steps) != len(set(self.completed_steps)) or len(self.side_effect_idempotency_keys) != len(set(self.side_effect_idempotency_keys)):
            raise ValueError("checkpoint steps and side effect keys must be unique")
        if _contains_forbidden_key(self.model_dump(mode="python")):
            raise ValueError("checkpoint contains forbidden secret or reasoning data")
        return self


class FailureSignals(RuntimeContractModel):
    provider_error: bool = False
    rate_limited: bool = False
    affected_workspaces: int = Field(default=1, ge=1)
    affected_worker_ratio: float = Field(default=0, ge=0, le=1)
    provider_status_degraded: bool = False
    local_worker_error: bool = False
    deterministic_error: bool = False
    tool_health_confirmed: bool = False


class RetryDecisionSnapshot(RuntimeContractModel):
    decision: RetryDecision
    reason: RetryReason
    failure_classification: FailureClassification
    classification_confidence: float = Field(ge=0, le=1)
    classifier_version: str = Field(min_length=1, max_length=100)
    bucket_policy_version: str = Field(min_length=1, max_length=100)
    workspace_tokens_before: float = Field(ge=0)
    workspace_tokens_after: float = Field(ge=0)
    global_tokens_before: float = Field(ge=0)
    global_tokens_after: float = Field(ge=0)
    retry_ready_at: datetime | None = None

    @field_validator("retry_ready_at")
    @classmethod
    def validate_retry_ready_at(cls, value: datetime | None) -> datetime | None:
        return None if value is None else _require_timezone(value, "retry ready_at")

class TaskCommand(RuntimeContractModel):
    command_id: UUID
    task_id: UUID
    run_id: UUID
    workspace_id: UUID
    attempt_id: UUID | None = None
    expected_revision: int = Field(ge=1)
    type: TaskCommandType
    status: TaskCommandStatus = TaskCommandStatus.PENDING
    idempotency_key: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    requested_by: UUID
    requested_at: datetime
    payload: dict[str, Any] = Field(default_factory=dict)
    authorization_revision: int = Field(default=1, ge=1)
    budget_revision: int = Field(default=1, ge=1)
    schema_version: str = TASK_CONTRACT_SCHEMA_VERSION

    @field_validator("requested_at")
    @classmethod
    def validate_requested_at(cls, value: datetime) -> datetime:
        return _require_timezone(value, "command requested_at")

    @field_validator("payload")
    @classmethod
    def validate_payload(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(value) > 50:
            raise ValueError("command payload has too many fields")
        if _contains_forbidden_key(value):
            raise ValueError("command payload contains a forbidden secret or reasoning field")
        return value

    @model_validator(mode="after")
    def validate_schema_version(self) -> TaskCommand:
        if self.schema_version != TASK_CONTRACT_SCHEMA_VERSION:
            raise ValueError("task contract schema version is unsupported")
        return self

class TaskEvent(RuntimeContractModel):
    event_id: str = Field(min_length=1, max_length=128)
    source: str = Field(min_length=1, max_length=64)
    source_event_id: str = Field(min_length=1, max_length=128)
    task_id: UUID
    run_id: UUID
    workspace_id: UUID
    task_revision: int = Field(ge=1)
    attempt_id: UUID | None = None
    sequence: int = Field(ge=1)
    type: str = Field(pattern=r"^[a-z]+(?:\.[a-z]+)+$", max_length=100)
    occurred_at: datetime
    data: dict[str, Any] = Field(default_factory=dict)
    schema_version: str = TASK_CONTRACT_SCHEMA_VERSION

    @field_validator("occurred_at")
    @classmethod
    def validate_occurred_at(cls, value: datetime) -> datetime:
        return _require_timezone(value, "event occurred_at")

    @field_validator("data")
    @classmethod
    def validate_data(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(value) > 100:
            raise ValueError("event data has too many fields")
        if _contains_forbidden_key(value):
            raise ValueError("event data contains a forbidden secret or reasoning field")
        return value

    @model_validator(mode="after")
    def validate_schema_version(self) -> TaskEvent:
        if self.schema_version != TASK_CONTRACT_SCHEMA_VERSION:
            raise ValueError("task contract schema version is unsupported")
        return self


TASK_TRANSITIONS: Mapping[TaskStatus, frozenset[TaskStatus]] = {
    TaskStatus.SUBMITTED: frozenset((TaskStatus.ADMITTED, TaskStatus.DEFERRED, TaskStatus.REJECTED, TaskStatus.CANCELLED, TaskStatus.SUPERSEDED)),
    TaskStatus.ADMITTED: frozenset((TaskStatus.QUEUED, TaskStatus.CANCELLED, TaskStatus.SUPERSEDED)),
    TaskStatus.DEFERRED: frozenset((TaskStatus.ADMITTED, TaskStatus.REJECTED, TaskStatus.CANCELLED, TaskStatus.SUPERSEDED)),
    TaskStatus.QUEUED: frozenset((TaskStatus.RUNNING, TaskStatus.DEFERRED, TaskStatus.PAUSED, TaskStatus.CANCELLED, TaskStatus.SUPERSEDED)),
    TaskStatus.RUNNING: frozenset((TaskStatus.CHECKPOINTED, TaskStatus.PAUSED, TaskStatus.RETRY_WAIT, TaskStatus.WAITING_FOR_CAPACITY, TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED, TaskStatus.SUPERSEDED)),
    TaskStatus.CHECKPOINTED: frozenset((TaskStatus.RUNNING, TaskStatus.PAUSED, TaskStatus.RETRY_WAIT, TaskStatus.WAITING_FOR_CAPACITY, TaskStatus.FAILED, TaskStatus.CANCELLED, TaskStatus.SUPERSEDED)),
    TaskStatus.PAUSED: frozenset((TaskStatus.ADMITTED, TaskStatus.DEFERRED, TaskStatus.REJECTED, TaskStatus.CANCELLED, TaskStatus.SUPERSEDED)),
    TaskStatus.RETRY_WAIT: frozenset((TaskStatus.ADMITTED, TaskStatus.DEFERRED, TaskStatus.REJECTED, TaskStatus.CANCELLED, TaskStatus.SUPERSEDED)),
    TaskStatus.WAITING_FOR_CAPACITY: frozenset((TaskStatus.ADMITTED, TaskStatus.REJECTED, TaskStatus.CANCELLED, TaskStatus.SUPERSEDED)),
    TaskStatus.COMPLETED: frozenset(),
    TaskStatus.FAILED: frozenset(),
    TaskStatus.CANCELLED: frozenset(),
    TaskStatus.REJECTED: frozenset(),
    TaskStatus.SUPERSEDED: frozenset()
}

ATTEMPT_TRANSITIONS: Mapping[AttemptStatus, frozenset[AttemptStatus]] = {
    AttemptStatus.PREDICTED: frozenset((AttemptStatus.QUEUED, AttemptStatus.CANCELLED, AttemptStatus.SUPERSEDED)),
    AttemptStatus.QUEUED: frozenset((AttemptStatus.RUNNING, AttemptStatus.CANCELLED, AttemptStatus.SUPERSEDED)),
    AttemptStatus.RUNNING: frozenset((AttemptStatus.CHECKPOINTED, AttemptStatus.COMPLETED, AttemptStatus.FAILED, AttemptStatus.CANCELLED, AttemptStatus.SUPERSEDED)),
    AttemptStatus.CHECKPOINTED: frozenset((AttemptStatus.RUNNING, AttemptStatus.FAILED, AttemptStatus.CANCELLED, AttemptStatus.SUPERSEDED)),
    AttemptStatus.COMPLETED: frozenset(),
    AttemptStatus.FAILED: frozenset(),
    AttemptStatus.CANCELLED: frozenset(),
    AttemptStatus.SUPERSEDED: frozenset()
}


def ensure_task_transition(current: TaskStatus, target: TaskStatus) -> None:
    if target not in TASK_TRANSITIONS[current]:
        raise TaskTransitionError(f"task transition {current.value} -> {target.value} is not allowed")

def ensure_attempt_transition(current: AttemptStatus, target: AttemptStatus) -> None:
    if target not in ATTEMPT_TRANSITIONS[current]:
        raise TaskTransitionError(f"attempt transition {current.value} -> {target.value} is not allowed")

def ensure_expected_revision(actual_revision: int, expected_revision: int) -> None:
    if actual_revision != expected_revision:
        raise TaskRevisionConflictError(
            f"task revision conflict: expected {expected_revision}, current {actual_revision}"
        )

def ensure_next_revision(current_revision: int, proposed_revision: int) -> None:
    if proposed_revision != current_revision + 1:
        raise TaskRevisionConflictError(
            f"next task revision must be {current_revision + 1}, got {proposed_revision}"
        )

def ensure_workspace_scope(expected_workspace_id: UUID, actual_workspace_id: UUID) -> None:
    if expected_workspace_id != actual_workspace_id:
        raise TaskScopeError("task workspace does not match the trusted execution context")

def _contains_forbidden_key(value: object) -> bool:
    if isinstance(value, Mapping):
        return any(
            str(key).lower() in FORBIDDEN_RUNTIME_DATA_KEYS or _contains_forbidden_key(item)
            for key, item in value.items()
        )
    if isinstance(value, (list, tuple)):
        return any(_contains_forbidden_key(item) for item in value)
    return False

def _require_timezone(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
    return value
