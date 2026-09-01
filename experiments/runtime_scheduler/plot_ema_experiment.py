from __future__ import annotations

from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt

from .prototype import ModelKind, RuntimePredictor, apply_causal_ema, chronological_split_history, generate_synthetic_history, regression_metrics


MODEL_KINDS = {"LinearRegression": ModelKind.LINEAR, "RandomForest": ModelKind.RANDOM_FOREST, "XGBoost": ModelKind.XGBOOST}
COLORS = {"LinearRegression": "tab:blue", "RandomForest": "tab:orange", "XGBoost": "tab:green"}


def evaluate_ema(*, latency_drift: float, alpha: float = 0.1, sample_count: int = 5_000, random_seed: int = 42) -> dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]]:
    history = generate_synthetic_history(sample_count, random_seed=random_seed, latency_drift=latency_drift)
    training, validation = chronological_split_history(history)
    actual = np.asarray([record.runtime_seconds for record in validation], dtype=float)
    results: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
    for name, model_kind in MODEL_KINDS.items():
        predictor = RuntimePredictor(model_kind, random_seed=random_seed).fit(training)
        base = np.asarray([predictor.predict(record.task) for record in validation], dtype=float)
        ema = np.asarray(apply_causal_ema(actual.tolist(), base.tolist(), alpha=alpha), dtype=float)
        results[name] = (actual, base, ema)
    return results


def build_ema_plot(output_path: Path | None = None, *, alpha: float = 0.1, sample_count: int = 5_000, random_seed: int = 42) -> Path:
    stationary = evaluate_ema(latency_drift=0.0, alpha=alpha, sample_count=sample_count, random_seed=random_seed)
    drifting = evaluate_ema(latency_drift=0.3, alpha=alpha, sample_count=sample_count, random_seed=random_seed)
    figure, axes = plt.subplots(2, 2, figsize=(15, 10), constrained_layout=True)

    for axis, title, results in ((axes[0, 0], "Stationary workload", stationary), (axes[0, 1], "30% latency drift", drifting)):
        labels: list[str] = []
        base_mae: list[float] = []
        ema_mae: list[float] = []
        for name, (actual, base, ema) in results.items():
            labels.append(name)
            base_mae.append(regression_metrics(actual.tolist(), base.tolist()).mae_seconds)
            ema_mae.append(regression_metrics(actual.tolist(), ema.tolist()).mae_seconds)
        positions = np.arange(len(labels))
        axis.bar(positions - 0.18, base_mae, width=0.36, color="tab:gray", label="Base")
        axis.bar(positions + 0.18, ema_mae, width=0.36, color="tab:purple", label=f"EMA α={alpha}")
        axis.set_xticks(positions, labels)
        axis.set_title(title)
        axis.set_ylabel("MAE (seconds)")
        axis.legend()

    actual, base, ema = drifting["XGBoost"]
    steps = np.arange(len(actual))
    window = 50
    base_rolling = np.convolve(np.abs(actual - base), np.ones(window) / window, mode="valid")
    ema_rolling = np.convolve(np.abs(actual - ema), np.ones(window) / window, mode="valid")
    axes[1, 0].plot(steps[window - 1:], base_rolling, color="tab:gray", linewidth=1.8, label="XGBoost base")
    axes[1, 0].plot(steps[window - 1:], ema_rolling, color="tab:green", linewidth=1.8, label=f"XGBoost + EMA α={alpha}")
    axes[1, 0].set_title("Drift workload · rolling absolute error")
    axes[1, 0].set_xlabel("Validation task sequence")
    axes[1, 0].set_ylabel(f"Rolling MAE · window {window} (seconds)")
    axes[1, 0].legend()

    residual = actual - base
    residual_ema = np.zeros_like(residual)
    for index in range(1, len(residual)):
        residual_ema[index] = alpha * residual[index - 1] + (1 - alpha) * residual_ema[index - 1]
    sample = slice(None, None, 5)
    axes[1, 1].plot(steps[sample], residual[sample], color="tab:gray", alpha=0.35, linewidth=1, label="Observed residual")
    axes[1, 1].plot(steps, residual_ema, color="tab:green", linewidth=2, label="Causal residual EMA")
    axes[1, 1].axhline(0, color="black", linestyle="--", linewidth=1)
    axes[1, 1].set_title("XGBoost residual EMA under drift")
    axes[1, 1].set_xlabel("Validation task sequence")
    axes[1, 1].set_ylabel("Residual correction (seconds)")
    axes[1, 1].legend()

    figure.suptitle("Causal EMA residual calibration · prediction before update", fontsize=16)
    destination = output_path or Path(__file__).with_name("runtime_prediction_ema_comparison.png")
    figure.savefig(destination, dpi=160, bbox_inches="tight")
    plt.close(figure)
    return destination


def main() -> None:
    stationary = evaluate_ema(latency_drift=0.0)
    drifting = evaluate_ema(latency_drift=0.3)
    for scenario, results in (("stationary", stationary), ("30% latency drift", drifting)):
        print(f"\n{scenario}")
        for name, (actual, base, ema) in results.items():
            base_metrics = regression_metrics(actual.tolist(), base.tolist())
            ema_metrics = regression_metrics(actual.tolist(), ema.tolist())
            print(f"{name}: base MAE={base_metrics.mae_seconds:.2f}s, EMA MAE={ema_metrics.mae_seconds:.2f}s, base R2={base_metrics.r2:.3f}, EMA R2={ema_metrics.r2:.3f}")
    print(build_ema_plot())


if __name__ == "__main__":
    main()
