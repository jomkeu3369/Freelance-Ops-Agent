from __future__ import annotations

import math
from collections.abc import Sequence
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
from xgboost import XGBRegressor

from .task_models import AgentTask, ModelKind, RegressionMetrics, TaskExecutionLog


def _task_matrix(tasks: Sequence[AgentTask]) -> list[list[object]]:
    if not tasks:
        raise ValueError("at least one task is required")
    return [task.feature_row() for task in tasks]


def _build_preprocessor() -> ColumnTransformer:
    transformers = [
        ("categorical", OneHotEncoder(handle_unknown="ignore", sparse_output=False), [0, 1]),
        ("numeric", StandardScaler(), [2, 3, 4, 5]),
    ]
    return ColumnTransformer(transformers=transformers, remainder="drop")


def _build_estimator(model_kind: ModelKind, random_seed: int) -> RegressorMixin:
    if model_kind is ModelKind.LINEAR:
        return LinearRegression()

    if model_kind is ModelKind.RANDOM_FOREST:
        return RandomForestRegressor(
            n_estimators=180, min_samples_leaf=2, random_state=random_seed, n_jobs=1
        )
    if model_kind is ModelKind.XGBOOST:
        return XGBRegressor(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.85,
            colsample_bytree=0.90,
            objective="reg:squarederror",
            random_state=random_seed,
            n_jobs=1,
            tree_method="hist"
        )
    raise ValueError(f"unsupported model kind: {model_kind}")


class RuntimePredictor:
    def __init__(self, model_kind: ModelKind = ModelKind.RANDOM_FOREST, *, random_seed: int = 42, minimum_prediction_seconds: float = 0.01) -> None:
        if minimum_prediction_seconds <= 0:
            raise ValueError("minimum_prediction_seconds must be positive")

        self.model_kind = model_kind
        self.random_seed = random_seed
        self.minimum_prediction_seconds = minimum_prediction_seconds
        steps = [
            ("preprocessor", _build_preprocessor()),
            ("regressor", _build_estimator(model_kind, random_seed)),
        ]
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
    return RegressionMetrics(
        mae_seconds=float(mean_absolute_error(actual, predicted)),
        rmse_seconds=math.sqrt(mse),
        r2=float(r2_score(actual, predicted))
    )


def compare_models(training_history: Sequence[TaskExecutionLog], validation_history: Sequence[TaskExecutionLog], *, random_seed: int = 42) -> dict[str, RegressionMetrics]:
    if not training_history or not validation_history:
        raise ValueError("training and validation history must not be empty")

    train_targets = [record.runtime_seconds for record in training_history]
    validation_targets = [record.runtime_seconds for record in validation_history]
    validation_tasks = [record.task for record in validation_history]

    baseline = DummyRegressor(strategy="median")
    baseline.fit([[0.0]] * len(train_targets), train_targets)
    baseline_predictions = [
        float(value) for value in baseline.predict([[0.0]] * len(validation_targets))
    ]
    results = {"MedianBaseline": regression_metrics(validation_targets, baseline_predictions)}

    for kind, label in (
        (ModelKind.LINEAR, "LinearRegression"),
        (ModelKind.RANDOM_FOREST, "RandomForest"),
        (ModelKind.XGBOOST, "XGBoost"),
    ):
        predictor = RuntimePredictor(kind, random_seed=random_seed).fit(training_history)
        predictions = [predictor.predict(task) for task in validation_tasks]
        results[label] = regression_metrics(validation_targets, predictions)

    return results
