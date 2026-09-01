from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import pytest

from .prototype import FEATURE_NAMES, POST_EXECUTION_METADATA, AgentTask, DriftGatedEmaCalibrator, EmaResidualCalibrator, ModelKind, OnlineResidualRegressor, RuntimePredictor, TaskExecutionLog, apply_causal_ema, apply_drift_gated_ema, apply_rolling_median_residual, compare_models, generate_synthetic_history, replay_online_residual_learning, split_history, with_post_execution_metadata


def test_synthetic_dataset_is_reproducible_and_has_requested_size() -> None:
    first = generate_synthetic_history(100, random_seed=7)
    second = generate_synthetic_history(100, random_seed=7)

    assert len(first) == 100
    assert first == second
    assert len({record.task.task_type for record in first}) > 1
    assert len({record.task.model for record in first}) > 1


@pytest.mark.parametrize("model_kind", list(ModelKind))
def test_model_fits_and_predicts_a_positive_float(model_kind: ModelKind) -> None:
    history = generate_synthetic_history(600)
    predictor = RuntimePredictor(model_kind).fit(history)

    prediction = predictor.predict(history[0].task)

    assert isinstance(prediction, float)
    assert prediction > 0


@pytest.mark.filterwarnings("ignore:Setting the shape on a NumPy array has been deprecated:DeprecationWarning")
def test_save_and_load_preserve_prediction(tmp_path: Path) -> None:
    history = generate_synthetic_history(500)
    predictor = RuntimePredictor(ModelKind.RANDOM_FOREST).fit(history)
    task = history[-1].task
    artifact = tmp_path / "runtime-predictor.joblib"

    predictor.save(artifact)
    loaded = RuntimePredictor.load(artifact)

    assert loaded.predict(task) == pytest.approx(predictor.predict(task), rel=0.0, abs=1e-12)


def test_unknown_categories_do_not_crash_prediction() -> None:
    history = generate_synthetic_history(500)
    predictor = RuntimePredictor(ModelKind.LINEAR).fit(history)
    unseen = AgentTask(task_type="brand_new_specialist", model="future-model-v9", input_tokens=12_000, context_tokens=24_000, file_count=8, subagent_depth=1)

    assert predictor.predict(unseen) > 0


def test_runtime_target_is_not_queue_wait_time() -> None:
    record = generate_synthetic_history(1, random_seed=9)[0]
    delayed_start = record.started_at + timedelta(seconds=90)
    delayed_completion = delayed_start + timedelta(seconds=record.runtime_seconds)
    delayed = TaskExecutionLog(task_id=record.task_id, task=record.task, queued_at=record.queued_at, started_at=delayed_start, completed_at=delayed_completion, runtime_seconds=record.runtime_seconds, success=record.success)

    assert delayed.queue_wait_time_seconds == pytest.approx(record.queue_wait_time_seconds + 90)
    assert delayed.runtime_seconds == record.runtime_seconds

    with pytest.raises(ValueError, match="completed_at - started_at"):
        TaskExecutionLog(task_id=record.task_id, task=record.task, queued_at=record.queued_at, started_at=record.started_at, completed_at=record.completed_at, runtime_seconds=record.runtime_seconds + 1, success=True)


def test_post_execution_metadata_is_excluded_from_features() -> None:
    record = generate_synthetic_history(1)[0]
    changed = with_post_execution_metadata(record, actual_tool_calls=999, output_tokens=999_999, retry_count=99, success=not record.success)

    assert record.task.feature_row() == changed.task.feature_row()
    assert set(FEATURE_NAMES).isdisjoint(POST_EXECUTION_METADATA)


def test_models_improve_mae_over_a_no_feature_baseline() -> None:
    history = generate_synthetic_history(3_000, random_seed=42)
    training, validation = split_history(history, random_seed=42)

    metrics = compare_models(training, validation, random_seed=42)

    baseline_mae = metrics["MedianBaseline"].mae_seconds
    assert metrics["LinearRegression"].mae_seconds < baseline_mae * 0.65
    assert metrics["RandomForest"].mae_seconds < baseline_mae * 0.45
    assert metrics["XGBoost"].mae_seconds < baseline_mae * 0.45
    assert metrics["RandomForest"].r2 > 0.80
    assert metrics["XGBoost"].r2 > 0.80


def test_ema_uses_only_previously_observed_residuals() -> None:
    corrected = apply_causal_ema([20.0, 20.0, 20.0], [10.0, 10.0, 10.0], alpha=0.5)

    assert corrected == pytest.approx([10.0, 15.0, 17.5])


def test_ema_rejects_invalid_alpha() -> None:
    with pytest.raises(ValueError, match="alpha"):
        EmaResidualCalibrator(alpha=0.0)


def test_drift_gated_ema_stays_inactive_without_sustained_error() -> None:
    result = apply_drift_gated_ema([10.0] * 100, [10.0] * 100)

    assert result.activation_index is None
    assert result.predictions == [10.0] * 100
    assert result.correction_history == [0.0] * 100


def test_drift_gated_ema_activates_after_sustained_bias_and_bounds_correction() -> None:
    result = apply_drift_gated_ema([20.0] * 150, [10.0] * 150, alpha=0.1)

    assert result.activation_index is not None
    assert result.predictions[0] == 10.0
    assert max(result.correction_history) <= 2.0
    assert result.predictions[-1] == pytest.approx(12.0)


def test_rolling_median_residual_is_causal_and_bounded() -> None:
    corrected = apply_rolling_median_residual([20.0] * 30, [10.0] * 30, window_size=20, minimum_samples=5)

    assert corrected[:5] == [10.0] * 5
    assert corrected[-1] == pytest.approx(12.0)


def test_drift_gated_calibrator_rejects_invalid_thresholds() -> None:
    with pytest.raises(ValueError, match="bias_threshold_seconds"):
        DriftGatedEmaCalibrator(bias_threshold_seconds=0.0)


def test_online_residual_regressor_predicts_before_learning_current_target() -> None:
    task = generate_synthetic_history(1)[0].task
    online = OnlineResidualRegressor()

    assert online.predict(task, 10.0) == 10.0
    online.update(task, 20.0, 10.0)
    assert online.predict(task, 10.0) > 10.0


def test_online_residual_correction_is_bounded() -> None:
    task = generate_synthetic_history(1)[0].task
    online = OnlineResidualRegressor()
    for _ in range(200):
        online.update(task, 100.0, 10.0)

    assert online.predict(task, 10.0) <= 12.0


def test_online_replay_uses_only_completed_tasks() -> None:
    history = generate_synthetic_history(200, random_seed=7)
    predictor = RuntimePredictor(ModelKind.XGBOOST).fit(history[:100])

    result = replay_online_residual_learning(history[100:], predictor)

    assert result.completed_updates_before_prediction[0] == 0
    assert all(previous <= current for previous, current in zip(result.completed_updates_before_prediction, result.completed_updates_before_prediction[1:], strict=False))
    assert result.completed_updates_before_prediction[-1] < len(history[100:])
