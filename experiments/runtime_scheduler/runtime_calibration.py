from __future__ import annotations

import math
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from hashlib import blake2b
from heapq import heappop, heappush

from sklearn.linear_model import SGDRegressor

from .runtime_prediction import RuntimePredictor
from .task_models import AgentTask, TaskExecutionLog


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
        if (
            actual_runtime <= 0
            or not math.isfinite(actual_runtime)
            or not math.isfinite(base_prediction)
        ):
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
        if (
            residual_clip_seconds <= 0
            or correction_limit_seconds <= 0
            or not 0 < correction_limit_ratio <= 1
        ):
            raise ValueError("online correction limits must be positive")
        self.hash_dimensions = hash_dimensions
        self.residual_clip_seconds = residual_clip_seconds
        self.correction_limit_seconds = correction_limit_seconds
        self.correction_limit_ratio = correction_limit_ratio
        self.model = SGDRegressor(
            loss="huber",
            epsilon=1.35,
            penalty="l2",
            alpha=0.0005,
            learning_rate="constant",
            eta0=0.02,
            random_state=random_seed
        )
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
        numeric = [
            1.0,
            input_scale,
            context_scale,
            file_scale,
            depth_scale,
            input_scale**2,
            context_scale**2,
            file_scale**2,
            input_scale * file_scale,
            context_scale * depth_scale,
        ]
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
        residual = max(
            -self.residual_clip_seconds,
            min(self.residual_clip_seconds, actual_runtime - base_prediction)
        )
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
        if (
            self.residual_clip_seconds <= 0
            or self.correction_limit_seconds <= 0
            or not 0 < self.correction_limit_ratio <= 1
        ):
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
        if (
            actual_runtime <= 0
            or not math.isfinite(actual_runtime)
            or not math.isfinite(base_prediction)
        ):
            raise ValueError("actual_runtime must be positive and both values must be finite")
        residual = actual_runtime - base_prediction
        clipped_residual = max(
            -self.residual_clip_seconds, min(self.residual_clip_seconds, residual)
        )
        clipped_error = min(self.residual_clip_seconds, abs(residual))
        self.residual_ema = self.alpha * clipped_residual + (1 - self.alpha) * self.residual_ema
        self.absolute_error_ema = (
            self.alpha * clipped_error + (1 - self.alpha) * self.absolute_error_ema
        )
        self.sample_count += 1
        breach = (
            self.sample_count >= self.minimum_samples
            and abs(self.residual_ema) >= self.bias_threshold_seconds
        )
        self.breach_count = self.breach_count + 1 if breach else 0
        if self.breach_count >= self.consecutive_breaches:
            self.active = True


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
    for index, (actual_runtime, base_prediction) in enumerate(
        zip(actual, base_predictions, strict=True)
    ):
        correction_history.append(calibrator.correction(base_prediction))
        predictions.append(calibrator.predict(base_prediction))
        calibrator.update(actual_runtime, base_prediction)
        residual_ema_history.append(calibrator.residual_ema)
        if calibrator.active and activation_index is None:
            activation_index = index + 1
    return GatedCalibrationResult(
        predictions=predictions,
        residual_ema_history=residual_ema_history,
        correction_history=correction_history,
        activation_index=activation_index
    )


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
    return OnlineLearningResult(
        predictions=predictions,
        correction_history=correction_history,
        completed_updates_before_prediction=completed_updates_before_prediction
    )
