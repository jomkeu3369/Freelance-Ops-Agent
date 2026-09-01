from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt

from .prototype import GatedCalibrationResult, ModelKind, RegressionMetrics, RuntimePredictor, apply_causal_ema, apply_drift_gated_ema, apply_rolling_median_residual, generate_synthetic_history, regression_metrics


@dataclass(frozen=True, slots=True)
class StrategyEvaluation:
    actual: np.ndarray
    predictions: dict[str, np.ndarray]
    metrics: dict[str, RegressionMetrics]
    gated: GatedCalibrationResult


def evaluate_strategies(*, latency_drift: float, sample_count: int = 5_000, random_seed: int = 42) -> StrategyEvaluation:
    history = sorted(generate_synthetic_history(sample_count, random_seed=random_seed, latency_drift=latency_drift), key=lambda record: record.queued_at)
    validation_start = round(len(history) * 0.75)
    deployment_history = history[:validation_start]
    validation_history = history[validation_start:]

    predictor = RuntimePredictor(ModelKind.XGBOOST, random_seed=random_seed).fit(deployment_history)
    actual = np.asarray([record.runtime_seconds for record in validation_history], dtype=float)
    base = np.asarray([predictor.predict(record.task) for record in validation_history], dtype=float)
    always_ema = np.asarray(apply_causal_ema(actual.tolist(), base.tolist(), alpha=0.1), dtype=float)
    rolling_median = np.asarray(apply_rolling_median_residual(actual.tolist(), base.tolist()), dtype=float)
    gated = apply_drift_gated_ema(actual.tolist(), base.tolist(), alpha=0.03)
    gated_predictions = np.asarray(gated.predictions, dtype=float)
    predictions = {"Base XGBoost": base, "Always EMA": always_ema, "Rolling median": rolling_median, "Drift-gated EMA": gated_predictions}
    metrics = {name: regression_metrics(actual.tolist(), prediction.tolist()) for name, prediction in predictions.items()}
    return StrategyEvaluation(actual=actual, predictions=predictions, metrics=metrics, gated=gated)


def build_gated_ema_plot(output_path: Path | None = None, *, sample_count: int = 5_000, random_seed: int = 42) -> Path:
    stationary = evaluate_strategies(latency_drift=0.0, sample_count=sample_count, random_seed=random_seed)
    drifting = evaluate_strategies(latency_drift=0.3, sample_count=sample_count, random_seed=random_seed)
    colors = {"Base XGBoost": "tab:gray", "Always EMA": "tab:purple", "Rolling median": "tab:orange", "Drift-gated EMA": "tab:green"}
    figure, axes = plt.subplots(2, 2, figsize=(15, 10), constrained_layout=True)

    for axis, title, evaluation in ((axes[0, 0], "Stationary workload", stationary), (axes[0, 1], "30% latency drift", drifting)):
        names = list(evaluation.metrics)
        values = [evaluation.metrics[name].mae_seconds for name in names]
        axis.bar(np.arange(len(names)), values, color=[colors[name] for name in names])
        axis.set_xticks(np.arange(len(names)), names, rotation=12)
        axis.set_title(title)
        axis.set_ylabel("MAE (seconds)")
        for index, value in enumerate(values):
            axis.text(index, value + 0.08, f"{value:.2f}", ha="center")

    steps = np.arange(len(drifting.actual))
    window = 50
    for name, prediction in drifting.predictions.items():
        rolling_error = np.convolve(np.abs(drifting.actual - prediction), np.ones(window) / window, mode="valid")
        axes[1, 0].plot(steps[window - 1:], rolling_error, color=colors[name], linewidth=1.7, label=name)
    if drifting.gated.activation_index is not None:
        axes[1, 0].axvline(drifting.gated.activation_index, color="tab:green", linestyle="--", linewidth=1.4, label=f"Gate active at {drifting.gated.activation_index}")
    axes[1, 0].set_title("Drift workload · rolling absolute error")
    axes[1, 0].set_xlabel("Validation task sequence")
    axes[1, 0].set_ylabel(f"Rolling MAE · window {window} (seconds)")
    axes[1, 0].legend()

    correction = np.asarray(drifting.gated.correction_history, dtype=float)
    residual_ema = np.asarray(drifting.gated.residual_ema_history, dtype=float)
    axes[1, 1].plot(steps, residual_ema, color="tab:blue", linewidth=1.5, label="Clipped residual EMA")
    axes[1, 1].plot(steps, correction, color="tab:green", linewidth=2, label="Applied correction")
    axes[1, 1].axhline(0, color="black", linestyle="--", linewidth=1)
    if drifting.gated.activation_index is not None:
        axes[1, 1].axvline(drifting.gated.activation_index, color="tab:green", linestyle="--", linewidth=1.4)
    axes[1, 1].set_title("Drift gate and bounded correction")
    axes[1, 1].set_xlabel("Validation task sequence")
    axes[1, 1].set_ylabel("Seconds")
    axes[1, 1].legend()

    figure.suptitle("XGBoost residual correction strategies · causal temporal evaluation", fontsize=16)
    destination = output_path or Path(__file__).with_name("runtime_prediction_gated_ema_comparison.png")
    figure.savefig(destination, dpi=160, bbox_inches="tight")
    plt.close(figure)
    return destination


def main() -> None:
    for scenario, drift in (("stationary", 0.0), ("30% latency drift", 0.3)):
        evaluation = evaluate_strategies(latency_drift=drift)
        print(f"\n{scenario} · activation={evaluation.gated.activation_index}")
        for name, metrics in evaluation.metrics.items():
            print(f"{name}: MAE={metrics.mae_seconds:.2f}s, RMSE={metrics.rmse_seconds:.2f}s, R2={metrics.r2:.3f}")
    print(build_gated_ema_plot())


if __name__ == "__main__":
    main()
