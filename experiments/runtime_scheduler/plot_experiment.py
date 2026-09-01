from __future__ import annotations

from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt

from .prototype import ModelKind, RuntimePredictor, generate_synthetic_history, regression_metrics, split_history


def build_plot(output_path: Path | None = None, sample_count: int = 5_000, random_seed: int = 42) -> Path:
    history = generate_synthetic_history(sample_count, random_seed=random_seed)
    training, validation = split_history(history, random_seed=random_seed)
    actual = np.asarray([record.runtime_seconds for record in validation], dtype=float)
    predictors = {"LinearRegression": RuntimePredictor(ModelKind.LINEAR, random_seed=random_seed).fit(training), "RandomForest": RuntimePredictor(ModelKind.RANDOM_FOREST, random_seed=random_seed).fit(training), "XGBoost": RuntimePredictor(ModelKind.XGBOOST, random_seed=random_seed).fit(training)}
    predictions = {name: np.asarray([predictor.predict(record.task) for record in validation], dtype=float) for name, predictor in predictors.items()}
    colors = {"LinearRegression": "tab:blue", "RandomForest": "tab:orange", "XGBoost": "tab:green"}

    figure, axes = plt.subplots(2, 2, figsize=(15, 10), constrained_layout=True)
    axes[0, 0].hist(actual, bins=45, color="tab:purple", alpha=0.78)
    axes[0, 0].axvline(float(np.median(actual)), color="black", linestyle="--", linewidth=1.4, label=f"median {np.median(actual):.2f}s")
    axes[0, 0].set_title("Actual runtime distribution")
    axes[0, 0].set_xlabel("Runtime (seconds)")
    axes[0, 0].set_ylabel("Task count")
    axes[0, 0].legend()

    upper = float(max(actual.max(), *(prediction.max() for prediction in predictions.values())))
    axes[0, 1].plot([0, upper], [0, upper], color="black", linestyle="--", linewidth=1.2, label="ideal")
    for name, prediction in predictions.items():
        metrics = regression_metrics(actual.tolist(), prediction.tolist())
        axes[0, 1].scatter(actual, prediction, s=13, alpha=0.22, color=colors[name], label=f"{name} · MAE {metrics.mae_seconds:.2f}s · R² {metrics.r2:.3f}")
    axes[0, 1].set_title("Actual vs predicted runtime")
    axes[0, 1].set_xlabel("Actual runtime (seconds)")
    axes[0, 1].set_ylabel("Predicted runtime (seconds)")
    axes[0, 1].legend()

    for name, prediction in predictions.items():
        order = np.argsort(prediction)
        groups = np.array_split(order, 10)
        predicted_centers = [float(prediction[group].mean()) for group in groups]
        residual_deviation = [float((actual[group] - prediction[group]).std()) for group in groups]
        axes[1, 0].plot(predicted_centers, residual_deviation, marker="o", linewidth=2, color=colors[name], label=name)
    axes[1, 0].set_title("Residual variance by predicted runtime")
    axes[1, 0].set_xlabel("Predicted runtime bin mean (seconds)")
    axes[1, 0].set_ylabel("Residual standard deviation (seconds)")
    axes[1, 0].legend()

    absolute_errors = [np.abs(actual - predictions[name]) for name in predictors]
    axes[1, 1].boxplot(absolute_errors, tick_labels=list(predictors), showfliers=False)
    axes[1, 1].set_title("Absolute error distribution")
    axes[1, 1].set_xlabel("Model")
    axes[1, 1].set_ylabel("Absolute error (seconds)")
    axes[1, 1].grid(axis="y", alpha=0.25)

    figure.suptitle(f"Runtime predictor comparison · validation {len(validation)} tasks", fontsize=16)
    destination = output_path or Path(__file__).with_name("runtime_prediction_comparison.png")
    figure.savefig(destination, dpi=160, bbox_inches="tight")
    plt.close(figure)
    return destination


def main() -> None:
    path = build_plot()
    print(path)


if __name__ == "__main__":
    main()
