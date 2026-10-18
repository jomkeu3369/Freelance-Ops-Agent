from __future__ import annotations

import math
from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum

FEATURE_NAMES = (
    "task_type",
    "model",
    "input_tokens",
    "context_tokens",
    "file_count",
    "subagent_depth",
)


POST_EXECUTION_METADATA = (
    "actual_tool_calls",
    "output_tokens",
    "retry_count",
    "runtime_seconds",
    "completed_at",
    "success",
)


class ModelKind(StrEnum):
    LINEAR = "linear_regression"
    RANDOM_FOREST = "random_forest"
    XGBOOST = "xgboost"


@dataclass(frozen=True, slots=True)
class AgentTask:
    """작업 시작 전에 알 수 있는 입력 특성."""

    task_type: str
    model: str
    input_tokens: int
    context_tokens: int
    file_count: int
    subagent_depth: int

    def __post_init__(self) -> None:
        if not self.task_type.strip() or not self.model.strip():
            raise ValueError("task_type and model must not be blank")

        numeric = (self.input_tokens, self.context_tokens, self.file_count, self.subagent_depth)
        if any(value < 0 for value in numeric):
            raise ValueError("task numeric features must be non-negative")

    def feature_row(self) -> list[object]:
        return [
            self.task_type,
            self.model,
            self.input_tokens,
            self.context_tokens,
            self.file_count,
            self.subagent_depth,
        ]


@dataclass(frozen=True, slots=True)
class TaskExecutionLog:
    """실행 전 입력과 실행 후 관측값을 구분해 보관하는 학습 이력."""

    task_id: str
    task: AgentTask
    queued_at: datetime
    started_at: datetime
    completed_at: datetime
    runtime_seconds: float
    success: bool
    actual_tool_calls: int = 0
    output_tokens: int = 0
    retry_count: int = 0

    def __post_init__(self) -> None:
        if not self.task_id.strip():
            raise ValueError("task_id must not be blank")

        timestamps = (self.queued_at, self.started_at, self.completed_at)
        if any(value.tzinfo is None or value.utcoffset() is None for value in timestamps):
            raise ValueError("execution timestamps must be timezone-aware")

        if not self.queued_at <= self.started_at <= self.completed_at:
            raise ValueError("timestamps must satisfy queued_at <= started_at <= completed_at")

        if any(
            value < 0 for value in (self.actual_tool_calls, self.output_tokens, self.retry_count)
        ):
            raise ValueError("post-execution counters must be non-negative")

        measured = (self.completed_at - self.started_at).total_seconds()
        if self.runtime_seconds <= 0 or not math.isclose(
            self.runtime_seconds, measured, rel_tol=0.0, abs_tol=1e-6
        ):
            raise ValueError("runtime_seconds must equal completed_at - started_at")

    @property
    def queue_wait_time_seconds(self) -> float:
        return (self.started_at - self.queued_at).total_seconds()


@dataclass(frozen=True, slots=True)
class RegressionMetrics:
    mae_seconds: float
    rmse_seconds: float
    r2: float


def with_post_execution_metadata(record: TaskExecutionLog, *, actual_tool_calls: int, output_tokens: int, retry_count: int, success: bool) -> TaskExecutionLog:
    """실행 후 기록을 바꿔도 사전 입력 특성이 유지되는지 검사한다."""

    return replace(
        record,
        actual_tool_calls=actual_tool_calls,
        output_tokens=output_tokens,
        retry_count=retry_count,
        success=success
    )
