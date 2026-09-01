from __future__ import annotations

import math
import random
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from hashlib import blake2b
from heapq import heappop, heappush
from pathlib import Path
from typing import Self

import joblib
from sklearn.base import RegressorMixin
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.linear_model import SGDRegressor
from xgboost import XGBRegressor

FEATURE_NAMES = ("task_type", "model", "input_tokens", "context_tokens", "file_count", "subagent_depth")
POST_EXECUTION_METADATA = ("actual_tool_calls", "output_tokens", "retry_count", "runtime_seconds", "completed_at", "success")


class ModelKind(StrEnum):
    LINEAR = "linear_regression"
    RANDOM_FOREST = "random_forest"
    XGBOOST = "xgboost"


@dataclass(frozen=True, slots=True)
class AgentTask:
    """Feature snapshot available before a task starts running."""

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
            self.subagent_depth
        ]


@dataclass(frozen=True, slots=True)
class TaskExecutionLog:
    """Immutable training record with pre- and post-execution fields kept separate."""

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

        if any(value < 0 for value in (self.actual_tool_calls, self.output_tokens, self.retry_count)):
            raise ValueError("post-execution counters must be non-negative")

        measured = (self.completed_at - self.started_at).total_seconds()
        if self.runtime_seconds <= 0 or not math.isclose(self.runtime_seconds, measured, rel_tol=0.0, abs_tol=1e-6):
            raise ValueError("runtime_seconds must equal completed_at - started_at")

    @property
    def queue_wait_time_seconds(self) -> float:
        return (self.started_at - self.queued_at).total_seconds()


@dataclass(frozen=True, slots=True)
class RegressionMetrics:
    mae_seconds: float
    rmse_seconds: float
    r2: float


@dataclass(slots=True)
class EmaResidualCalibrator:
    alpha: float = 0.1
    minimum_prediction_seconds: float = 0.01
    residual_ema: float = 0.0

    def __post_init__(self) -> None:
        if not 0 < self.alpha <= 1:
            raise ValueError("alpha must be in the interval (0, 1]")
        if self.minimum_prediction_seconds <= 0:
            raise ValueError("minimum_prediction_seconds must be positive")

    def predict(self, base_prediction: float) -> float:
        if not math.isfinite(base_prediction):
            raise ValueError("base_prediction must be finite")
        return max(self.minimum_prediction_seconds, base_prediction + self.residual_ema)

    def update(self, actual_runtime: float, base_prediction: float) -> None:
        if actual_runtime <= 0 or not math.isfinite(actual_runtime) or not math.isfinite(base_prediction):
            raise ValueError("actual_runtime must be positive and both values must be finite")
        residual = actual_runtime - base_prediction
        self.residual_ema = self.alpha * residual + (1 - self.alpha) * self.residual_ema


@dataclass(frozen=True, slots=True)
class GatedCalibrationResult:
    predictions: list[float]
    residual_ema_history: list[float]
    correction_history: list[float]
    activation_index: int | None


@dataclass(frozen=True, slots=True)
class OnlineLearningResult:
    predictions: list[float]
    correction_history: list[float]
    completed_updates_before_prediction: list[int]


class OnlineResidualRegressor:
    def __init__(self, *, random_seed: int = 42, hash_dimensions: int = 16, residual_clip_seconds: float = 10.0, correction_limit_seconds: float = 5.0, correction_limit_ratio: float = 0.2) -> None:
        if hash_dimensions < 4:
            raise ValueError("hash_dimensions must be at least four")
        if residual_clip_seconds <= 0 or correction_limit_seconds <= 0 or not 0 < correction_limit_ratio <= 1:
            raise ValueError("online correction limits must be positive")
        self.hash_dimensions = hash_dimensions
        self.residual_clip_seconds = residual_clip_seconds
        self.correction_limit_seconds = correction_limit_seconds
        self.correction_limit_ratio = correction_limit_ratio
        self.model = SGDRegressor(loss="huber", epsilon=1.35, penalty="l2", alpha=0.0005, learning_rate="constant", eta0=0.02, random_state=random_seed)
        self._fitted = False

    def feature_vector(self, task: AgentTask) -> list[float]:
        categorical = [0.0] * self.hash_dimensions
        for value in (f"task_type={task.task_type}", f"model={task.model}"):
            digest = blake2b(value.encode("utf-8"), digest_size=8).digest()
            encoded = int.from_bytes(digest, byteorder="big", signed=False)
            index = encoded % self.hash_dimensions
            categorical[index] += 1.0 if encoded & 1 else -1.0
        input_scale = math.log1p(task.input_tokens) / math.log1p(30_000)
        context_scale = math.log1p(task.context_tokens) / math.log1p(80_000)
        file_scale = task.file_count / 50
        depth_scale = task.subagent_depth / 2
        numeric = [1.0, input_scale, context_scale, file_scale, depth_scale, input_scale**2, context_scale**2, file_scale**2, input_scale * file_scale, context_scale * depth_scale]
        return [*categorical, *numeric]

    def correction(self, task: AgentTask, base_prediction: float) -> float:
        if not self._fitted:
            return 0.0
        raw = float(self.model.predict([self.feature_vector(task)])[0])
        limit = min(self.correction_limit_seconds, base_prediction * self.correction_limit_ratio)
        return max(-limit, min(limit, raw))

    def predict(self, task: AgentTask, base_prediction: float) -> float:
        return max(0.01, base_prediction + self.correction(task, base_prediction))

    def update(self, task: AgentTask, actual_runtime: float, base_prediction: float) -> None:
        residual = max(-self.residual_clip_seconds, min(self.residual_clip_seconds, actual_runtime - base_prediction))
        self.model.partial_fit([self.feature_vector(task)], [residual])
        self._fitted = True


@dataclass(slots=True)
class DriftGatedEmaCalibrator:
    alpha: float = 0.03
    minimum_samples: int = 50
    bias_threshold_seconds: float = 1.5
    consecutive_breaches: int = 25
    residual_clip_seconds: float = 10.0
    correction_limit_seconds: float = 5.0
    correction_limit_ratio: float = 0.2
    residual_ema: float = 0.0
    absolute_error_ema: float = 0.0
    sample_count: int = 0
    breach_count: int = 0
    active: bool = False

    def __post_init__(self) -> None:
        if not 0 < self.alpha <= 1:
            raise ValueError("alpha must be in the interval (0, 1]")
        if self.minimum_samples < 1 or self.consecutive_breaches < 1:
            raise ValueError("sample thresholds must be positive")
        if self.bias_threshold_seconds <= 0:
            raise ValueError("bias_threshold_seconds must be positive")
        if self.residual_clip_seconds <= 0 or self.correction_limit_seconds <= 0 or not 0 < self.correction_limit_ratio <= 1:
            raise ValueError("correction limits must be positive")

    def correction(self, base_prediction: float) -> float:
        if not self.active:
            return 0.0
        limit = min(self.correction_limit_seconds, base_prediction * self.correction_limit_ratio)
        return max(-limit, min(limit, self.residual_ema))

    def predict(self, base_prediction: float) -> float:
        if not math.isfinite(base_prediction):
            raise ValueError("base_prediction must be finite")
        return max(0.01, base_prediction + self.correction(base_prediction))

    def update(self, actual_runtime: float, base_prediction: float) -> None:
        if actual_runtime <= 0 or not math.isfinite(actual_runtime) or not math.isfinite(base_prediction):
            raise ValueError("actual_runtime must be positive and both values must be finite")
        residual = actual_runtime - base_prediction
        clipped_residual = max(-self.residual_clip_seconds, min(self.residual_clip_seconds, residual))
        clipped_error = min(self.residual_clip_seconds, abs(residual))
        self.residual_ema = self.alpha * clipped_residual + (1 - self.alpha) * self.residual_ema
        self.absolute_error_ema = self.alpha * clipped_error + (1 - self.alpha) * self.absolute_error_ema
        self.sample_count += 1
        breach = self.sample_count >= self.minimum_samples and abs(self.residual_ema) >= self.bias_threshold_seconds
        self.breach_count = self.breach_count + 1 if breach else 0
        if self.breach_count >= self.consecutive_breaches:
            self.active = True


def _task_matrix(tasks: Sequence[AgentTask]) -> list[list[object]]:
    if not tasks:
        raise ValueError("at least one task is required")
    return [task.feature_row() for task in tasks]


def _build_preprocessor() -> ColumnTransformer:
    transformers = [("categorical", OneHotEncoder(handle_unknown="ignore", sparse_output=False), [0, 1]), ("numeric", StandardScaler(), [2, 3, 4, 5])]
    return ColumnTransformer(transformers=transformers, remainder="drop")


def _build_estimator(model_kind: ModelKind, random_seed: int) -> RegressorMixin:
    if model_kind is ModelKind.LINEAR:
        return LinearRegression()

    if model_kind is ModelKind.RANDOM_FOREST:
        return RandomForestRegressor(n_estimators=180, min_samples_leaf=2, random_state=random_seed, n_jobs=1)
    if model_kind is ModelKind.XGBOOST:
        return XGBRegressor(n_estimators=300, max_depth=6, learning_rate=0.05, subsample=0.85, colsample_bytree=0.90, objective="reg:squarederror", random_state=random_seed, n_jobs=1, tree_method="hist")
    raise ValueError(f"unsupported model kind: {model_kind}")


class RuntimePredictor:
    def __init__(self, model_kind: ModelKind = ModelKind.RANDOM_FOREST, *, random_seed: int = 42, minimum_prediction_seconds: float = 0.01) -> None:
        if minimum_prediction_seconds <= 0:
            raise ValueError("minimum_prediction_seconds must be positive")

        self.model_kind = model_kind
        self.random_seed = random_seed
        self.minimum_prediction_seconds = minimum_prediction_seconds
        steps = [("preprocessor", _build_preprocessor()), ("regressor", _build_estimator(model_kind, random_seed))]
        self.pipeline = Pipeline(steps=steps)
        self._fitted = False

    def fit(self, history: Sequence[TaskExecutionLog]) -> Self:
        if len(history) < 2:
            raise ValueError("at least two execution logs are required")

        tasks = [record.task for record in history]
        targets = [record.runtime_seconds for record in history]

        self.pipeline.fit(_task_matrix(tasks), targets)
        self._fitted = True

        return self

    def predict(self, task: AgentTask) -> float:
        if not self._fitted:
            raise RuntimeError("predictor must be fitted before prediction")

        prediction = float(self.pipeline.predict(_task_matrix([task]))[0])
        if not math.isfinite(prediction):
            raise RuntimeError("model returned a non-finite runtime prediction")

        return max(self.minimum_prediction_seconds, prediction)

    def save(self, path: str | Path) -> None:
        if not self._fitted:
            raise RuntimeError("only a fitted predictor can be saved")
        joblib.dump(self, Path(path))

    @classmethod
    def load(cls, path: str | Path) -> Self:
        loaded = joblib.load(Path(path))
        if not isinstance(loaded, cls):
            raise TypeError("artifact does not contain a RuntimePredictor")
        return loaded


def regression_metrics(actual: Sequence[float], predicted: Sequence[float]) -> RegressionMetrics:
    if len(actual) != len(predicted) or not actual:
        raise ValueError("actual and predicted must have the same non-zero length")

    mse = float(mean_squared_error(actual, predicted))
    return RegressionMetrics(mae_seconds=float(mean_absolute_error(actual, predicted)), rmse_seconds=math.sqrt(mse), r2=float(r2_score(actual, predicted)))


def apply_causal_ema(actual: Sequence[float], base_predictions: Sequence[float], *, alpha: float = 0.1) -> list[float]:
    if len(actual) != len(base_predictions) or not actual:
        raise ValueError("actual and base_predictions must have the same non-zero length")
    calibrator = EmaResidualCalibrator(alpha=alpha)
    corrected: list[float] = []
    for actual_runtime, base_prediction in zip(actual, base_predictions, strict=True):
        corrected.append(calibrator.predict(base_prediction))
        calibrator.update(actual_runtime, base_prediction)
    return corrected


def apply_drift_gated_ema(actual: Sequence[float], base_predictions: Sequence[float], *, alpha: float = 0.03) -> GatedCalibrationResult:
    if len(actual) != len(base_predictions) or not actual:
        raise ValueError("actual and base_predictions must have the same non-zero length")
    calibrator = DriftGatedEmaCalibrator(alpha=alpha)
    predictions: list[float] = []
    residual_ema_history: list[float] = []
    correction_history: list[float] = []
    activation_index: int | None = None
    for index, (actual_runtime, base_prediction) in enumerate(zip(actual, base_predictions, strict=True)):
        correction_history.append(calibrator.correction(base_prediction))
        predictions.append(calibrator.predict(base_prediction))
        calibrator.update(actual_runtime, base_prediction)
        residual_ema_history.append(calibrator.residual_ema)
        if calibrator.active and activation_index is None:
            activation_index = index + 1
    return GatedCalibrationResult(predictions=predictions, residual_ema_history=residual_ema_history, correction_history=correction_history, activation_index=activation_index)


def apply_rolling_median_residual(actual: Sequence[float], base_predictions: Sequence[float], *, window_size: int = 50, minimum_samples: int = 20, correction_limit_seconds: float = 5.0, correction_limit_ratio: float = 0.2) -> list[float]:
    if len(actual) != len(base_predictions) or not actual:
        raise ValueError("actual and base_predictions must have the same non-zero length")
    if window_size < 1 or minimum_samples < 1 or minimum_samples > window_size:
        raise ValueError("rolling window parameters are invalid")
    residuals: deque[float] = deque(maxlen=window_size)
    corrected: list[float] = []
    for actual_runtime, base_prediction in zip(actual, base_predictions, strict=True):
        median_residual = 0.0 if len(residuals) < minimum_samples else float(np_median(residuals))
        limit = min(correction_limit_seconds, base_prediction * correction_limit_ratio)
        correction = max(-limit, min(limit, median_residual))
        corrected.append(max(0.01, base_prediction + correction))
        residuals.append(actual_runtime - base_prediction)
    return corrected


def np_median(values: Sequence[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2


def replay_online_residual_learning(history: Sequence[TaskExecutionLog], predictor: RuntimePredictor, *, random_seed: int = 42) -> OnlineLearningResult:
    if not history:
        raise ValueError("history must not be empty")
    ordered = sorted(history, key=lambda record: record.queued_at)
    online = OnlineResidualRegressor(random_seed=random_seed)
    pending: list[tuple[datetime, int, TaskExecutionLog, float]] = []
    predictions: list[float] = []
    correction_history: list[float] = []
    completed_updates_before_prediction: list[int] = []
    completed_updates = 0
    for index, record in enumerate(ordered):
        while pending and pending[0][0] <= record.queued_at:
            _, _, completed, completed_base = heappop(pending)
            online.update(completed.task, completed.runtime_seconds, completed_base)
            completed_updates += 1
        base_prediction = predictor.predict(record.task)
        correction_history.append(online.correction(record.task, base_prediction))
        predictions.append(online.predict(record.task, base_prediction))
        completed_updates_before_prediction.append(completed_updates)
        heappush(pending, (record.completed_at, index, record, base_prediction))
    return OnlineLearningResult(predictions=predictions, correction_history=correction_history, completed_updates_before_prediction=completed_updates_before_prediction)


def compare_models(training_history: Sequence[TaskExecutionLog], validation_history: Sequence[TaskExecutionLog], *, random_seed: int = 42) -> dict[str, RegressionMetrics]:
    if not training_history or not validation_history:
        raise ValueError("training and validation history must not be empty")

    train_targets = [record.runtime_seconds for record in training_history]
    validation_targets = [record.runtime_seconds for record in validation_history]
    validation_tasks = [record.task for record in validation_history]

    baseline = DummyRegressor(strategy="median")
    baseline.fit([[0.0]] * len(train_targets), train_targets)
    baseline_predictions = [float(value) for value in baseline.predict([[0.0]] * len(validation_targets))]
    results = {"MedianBaseline": regression_metrics(validation_targets, baseline_predictions)}

    for kind, label in ((ModelKind.LINEAR, "LinearRegression"), (ModelKind.RANDOM_FOREST, "RandomForest"), (ModelKind.XGBOOST, "XGBoost")):
        predictor = RuntimePredictor(kind, random_seed=random_seed).fit(training_history)
        predictions = [predictor.predict(task) for task in validation_tasks]
        results[label] = regression_metrics(validation_targets, predictions)

    return results


def split_history(history: Sequence[TaskExecutionLog], *, validation_fraction: float = 0.25, random_seed: int = 42) -> tuple[list[TaskExecutionLog], list[TaskExecutionLog]]:
    if len(history) < 4:
        raise ValueError("at least four records are required to split history")

    if not 0 < validation_fraction < 1:
        raise ValueError("validation_fraction must be between zero and one")

    shuffled = list(history)
    random.Random(random_seed).shuffle(shuffled)
    validation_size = max(1, round(len(shuffled) * validation_fraction))

    return shuffled[validation_size:], shuffled[:validation_size]


def chronological_split_history(history: Sequence[TaskExecutionLog], *, validation_fraction: float = 0.25) -> tuple[list[TaskExecutionLog], list[TaskExecutionLog]]:
    if len(history) < 4:
        raise ValueError("at least four records are required to split history")
    if not 0 < validation_fraction < 1:
        raise ValueError("validation_fraction must be between zero and one")
    ordered = sorted(history, key=lambda record: record.queued_at)
    validation_size = max(1, round(len(ordered) * validation_fraction))
    return ordered[:-validation_size], ordered[-validation_size:]


def generate_synthetic_history(sample_count: int = 5_000, *, random_seed: int = 42, latency_drift: float = 0.0) -> list[TaskExecutionLog]:
    if sample_count < 1:
        raise ValueError("sample_count must be positive")
    if latency_drift < 0:
        raise ValueError("latency_drift must be non-negative")

    rng = random.Random(random_seed)
    task_complexity = {
        "tool_call": 0.55,
        "documentation": 0.85,
        "code_review": 1.25,
        "data_analysis": 1.45,
        "research": 1.70
    }
    model_latency = {
        "gpt-fast": 0.72,
        "gemini-fast": 0.80,
        "gpt-balanced": 1.00,
        "gpt-reasoning": 1.48
    }

    task_types = tuple(task_complexity)
    models = tuple(model_latency)
    origin = datetime(2026, 1, 1, tzinfo=UTC)
    history: list[TaskExecutionLog] = []

    for index in range(sample_count):
        task_type = rng.choice(task_types)
        model = rng.choice(models)
        input_tokens = round(math.exp(rng.uniform(math.log(300), math.log(30_000))))
        context_tokens = round(math.exp(rng.uniform(math.log(100), math.log(80_000)))) - 100
        file_count = min(50, round(rng.expovariate(1 / 8)))
        subagent_depth = rng.choices((0, 1, 2), weights=(0.60, 0.32, 0.08), k=1)[0]

        task = AgentTask(task_type=task_type, model=model, input_tokens=input_tokens, context_tokens=context_tokens, file_count=file_count, subagent_depth=subagent_depth)

        token_cost = 0.0028 * input_tokens**0.88
        context_cost = 0.00017 * context_tokens
        large_context_overhead = 0.000000010 * max(context_tokens - 30_000, 0) ** 2
        file_overhead = 0.72 * file_count + 0.055 * max(file_count - 12, 0) ** 2
        hierarchy_overhead = 5.5 * subagent_depth + 0.00006 * context_tokens * subagent_depth
        interaction = 0.000015 * input_tokens * file_count
        expected = 1.8 + model_latency[model] * task_complexity[task_type] * (
            token_cost
            + context_cost
            + large_context_overhead
            + file_overhead
            + hierarchy_overhead
            + interaction
        )
        drift_multiplier = 1 + latency_drift * index / max(sample_count - 1, 1)
        expected *= drift_multiplier
        noise = rng.gauss(0.0, 1.6 + expected * 0.09)
        runtime_seconds = round(max(0.05, expected + noise), 6)

        queued_at = origin + timedelta(seconds=index * 17)
        queue_wait_seconds = round(rng.expovariate(1 / 12), 6)
        started_at = queued_at + timedelta(seconds=queue_wait_seconds)
        completed_at = started_at + timedelta(seconds=runtime_seconds)
        record = TaskExecutionLog(task_id=f"synthetic-{index:06d}", task=task, queued_at=queued_at, started_at=started_at, completed_at=completed_at, runtime_seconds=runtime_seconds, success=rng.random() >= 0.025, actual_tool_calls=max(0, round(file_count / 3 + rng.gauss(1.0, 1.5))), output_tokens=max(0, round(input_tokens * rng.uniform(0.05, 0.35))), retry_count=rng.choices((0, 1, 2), weights=(0.91, 0.08, 0.01), k=1)[0])
        history.append(record)
    return history


def with_post_execution_metadata(record: TaskExecutionLog, *, actual_tool_calls: int, output_tokens: int, retry_count: int, success: bool) -> TaskExecutionLog:
    """Test helper proving post-execution metadata cannot alter the feature snapshot."""

    return replace(record, actual_tool_calls=actual_tool_calls, output_tokens=output_tokens, retry_count=retry_count, success=success)
