from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt

from .prototype import ModelKind, RegressionMetrics, RuntimePredictor, generate_synthetic_history, regression_metrics, replay_online_residual_learning


@dataclass(frozen=True, slots=True)
class OnlineScenarioEvaluation:
    actual: np.ndarray
    base: np.ndarray
    online: np.ndarray
    corrections: np.ndarray
    completed_updates: np.ndarray
    base_metrics: RegressionMetrics
    online_metrics: RegressionMetrics


def evaluate_online_scenario(*, latency_drift: float, sample_count: int = 5_000, random_seed: int = 42) -> OnlineScenarioEvaluation:
    history = sorted(generate_synthetic_history(sample_count, random_seed=random_seed, latency_drift=latency_drift), key=lambda record: record.queued_at)
    validation_start = round(len(history) * 0.75)
    predictor = RuntimePredictor(ModelKind.XGBOOST, random_seed=random_seed).fit(history[:validation_start])
    validation = history[validation_start:]
    actual = np.asarray([record.runtime_seconds for record in validation], dtype=float)
    base = np.asarray([predictor.predict(record.task) for record in validation], dtype=float)
    replay = replay_online_residual_learning(validation, predictor, random_seed=random_seed)
    online = np.asarray(replay.predictions, dtype=float)
    corrections = np.asarray(replay.correction_history, dtype=float)
    completed_updates = np.asarray(replay.completed_updates_before_prediction, dtype=int)
    return OnlineScenarioEvaluation(actual=actual, base=base, online=online, corrections=corrections, completed_updates=completed_updates, base_metrics=regression_metrics(actual.tolist(), base.tolist()), online_metrics=regression_metrics(actual.tolist(), online.tolist()))


def build_online_learning_plot(output_path: Path | None = None, *, sample_count: int = 5_000, random_seed: int = 42) -> Path:
    stationary = evaluate_online_scenario(latency_drift=0.0, sample_count=sample_count, random_seed=random_seed)
    drifting = evaluate_online_scenario(latency_drift=0.3, sample_count=sample_count, random_seed=random_seed)
    figure, axes = plt.subplots(2, 2, figsize=(15, 10), constrained_layout=True)

    labels = ["Base XGBoost", "XGBoost + online SGD"]
    for axis, title, evaluation in ((axes[0, 0], "Stationary workload", stationary), (axes[0, 1], "30% latency drift", drifting)):
        values = [evaluation.base_metrics.mae_seconds, evaluation.online_metrics.mae_seconds]
        axis.bar(np.arange(2), values, color=["tab:gray", "tab:green"])
        axis.set_xticks(np.arange(2), labels)
        axis.set_title(title)
        axis.set_ylabel("MAE (seconds)")
        for index, value in enumerate(values):
            axis.text(index, value + 0.06, f"{value:.2f}", ha="center")

    steps = np.arange(len(drifting.actual))
    window = 50
    base_rolling = np.convolve(np.abs(drifting.actual - drifting.base), np.ones(window) / window, mode="valid")
    online_rolling = np.convolve(np.abs(drifting.actual - drifting.online), np.ones(window) / window, mode="valid")
    axes[1, 0].plot(steps[window - 1:], base_rolling, color="tab:gray", linewidth=1.8, label="Base XGBoost")
    axes[1, 0].plot(steps[window - 1:], online_rolling, color="tab:green", linewidth=1.8, label="Online residual SGD")
    axes[1, 0].set_title("Drift workload · asynchronous rolling error")
    axes[1, 0].set_xlabel("Validation task enqueue sequence")
    axes[1, 0].set_ylabel(f"Rolling MAE · window {window} (seconds)")
    axes[1, 0].legend()

    axes[1, 1].plot(steps, drifting.corrections, color="tab:green", linewidth=1.5, label="Online correction")
    axes[1, 1].plot(steps, drifting.completed_updates / max(drifting.completed_updates.max(), 1) * 5, color="tab:blue", linewidth=1.2, alpha=0.65, label="Completed updates · normalized")
    axes[1, 1].axhline(0, color="black", linestyle="--", linewidth=1)
    axes[1, 1].set_title("Correction learned from completed tasks only")
    axes[1, 1].set_xlabel("Validation task enqueue sequence")
    axes[1, 1].set_ylabel("Correction (seconds)")
    axes[1, 1].legend()

    figure.suptitle("Real-time residual learning · XGBoost serving model + SGD partial_fit", fontsize=16)
    destination = output_path or Path(__file__).with_name("runtime_prediction_online_learning.png")
    figure.savefig(destination, dpi=160, bbox_inches="tight")
    plt.close(figure)
    return destination


def main() -> None:
    for scenario, drift in (("stationary", 0.0), ("30% latency drift", 0.3)):
        evaluation = evaluate_online_scenario(latency_drift=drift)
        print(f"\n{scenario}")
        print(f"Base XGBoost: MAE={evaluation.base_metrics.mae_seconds:.2f}s, RMSE={evaluation.base_metrics.rmse_seconds:.2f}s, R2={evaluation.base_metrics.r2:.3f}")
        print(f"Online residual SGD: MAE={evaluation.online_metrics.mae_seconds:.2f}s, RMSE={evaluation.online_metrics.rmse_seconds:.2f}s, R2={evaluation.online_metrics.r2:.3f}")
    print(build_online_learning_plot())


if __name__ == "__main__":
    main()
