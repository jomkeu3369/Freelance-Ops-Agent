from __future__ import annotations

import csv
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np

plt.switch_backend("Agg")

ROUTES = ("DIRECT_TOOL", "SIMPLE_LLM", "REACT_AGENT", "SUPERVISOR", "HUMAN_REQUIRED")
NATURAL_PRIOR = 0.90
RISK_PRIOR = 0.10
REVIEW_PER_STRATUM = 5_500


def _confusion_probabilities(gold_probabilities: np.ndarray, correct_probabilities: np.ndarray) -> np.ndarray:
    matrix = np.zeros((len(ROUTES), len(ROUTES)))
    for route_index, (gold_probability, correct_probability) in enumerate(zip(gold_probabilities, correct_probabilities)):
        matrix[route_index, :] = gold_probability * (1 - correct_probability) / (len(ROUTES) - 1)
        matrix[route_index, route_index] = gold_probability * correct_probability
    return matrix


def _metrics(matrix: np.ndarray) -> dict[str, float]:
    total = float(matrix.sum())
    true_positive = np.diag(matrix)
    truth = matrix.sum(axis=1)
    predicted = matrix.sum(axis=0)
    precision = np.divide(true_positive, predicted, out=np.zeros_like(true_positive, dtype=float), where=predicted > 0)
    recall = np.divide(true_positive, truth, out=np.zeros_like(true_positive, dtype=float), where=truth > 0)
    f1 = np.divide(2 * precision * recall, precision + recall, out=np.zeros_like(precision), where=precision + recall > 0)
    human_index = ROUTES.index("HUMAN_REQUIRED")
    return {
        "accuracy": float(true_positive.sum() / total),
        "macro_f1": float(f1.mean()),
        "human_required_recall": float(recall[human_index]),
        "false_automation_rate": float((truth[human_index] - true_positive[human_index]) / truth[human_index])
    }


def evaluate_sampling_bias(trials: int, seed: int) -> tuple[dict[str, float], list[dict[str, Any]]]:
    natural = _confusion_probabilities(np.array([0.38, 0.36, 0.06, 0.15, 0.05]), np.array([0.94, 0.91, 0.82, 0.88, 0.96]))
    risk = _confusion_probabilities(np.array([0.05, 0.05, 0.25, 0.25, 0.40]), np.array([0.80, 0.76, 0.62, 0.70, 0.92]))
    population = NATURAL_PRIOR * natural + RISK_PRIOR * risk
    truth = _metrics(population)
    rng = np.random.default_rng(seed)
    errors: dict[str, dict[str, list[float]]] = {
        strategy: {metric: [] for metric in truth} for strategy in ("naive_50_50", "post_stratified")
    }
    for _ in range(trials):
        natural_sample = rng.multinomial(REVIEW_PER_STRATUM, natural.ravel()).reshape(natural.shape)
        risk_sample = rng.multinomial(REVIEW_PER_STRATUM, risk.ravel()).reshape(risk.shape)
        estimates = {
            "naive_50_50": natural_sample + risk_sample,
            "post_stratified": NATURAL_PRIOR * natural_sample / REVIEW_PER_STRATUM + RISK_PRIOR * risk_sample / REVIEW_PER_STRATUM
        }
        for strategy, matrix in estimates.items():
            estimated = _metrics(matrix)
            for metric, true_value in truth.items():
                errors[strategy][metric].append(abs(estimated[metric] - true_value))
    summary = []
    for strategy, metrics in errors.items():
        for metric, values in metrics.items():
            summary.append({
                "strategy": strategy,
                "metric": metric,
                "true_value": truth[metric],
                "mean_absolute_error": float(np.mean(values)),
                "p95_absolute_error": float(np.quantile(values, 0.95))
            })
    return truth, summary


def evaluate_review_sampling_bias(output_dir: Path, trials: int = 2_000, seed: int = 20260827) -> list[Path]:
    truth, summary = evaluate_sampling_bias(trials, seed)
    payload = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "method": {
            "trials": trials,
            "seed": seed,
            "population_natural_prior": NATURAL_PRIOR,
            "population_risk_prior": RISK_PRIOR,
            "review_allocation": "50% natural / 50% risk",
            "reviews_per_stratum": REVIEW_PER_STRATUM
        },
        "population_truth": truth,
        "summary": summary
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "review_sampling_bias.json"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = output_dir / "review_sampling_bias_summary.csv"
    _write_csv(csv_path, summary)
    dashboard_path = output_dir / "review_sampling_bias_dashboard.png"
    _plot_dashboard(dashboard_path, summary)
    table_path = output_dir / "review_sampling_bias_table.png"
    _plot_table(table_path, summary)
    return [json_path, csv_path, dashboard_path, table_path]


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def _plot_dashboard(path: Path, rows: list[dict[str, Any]]) -> None:
    metrics = [metric for metric in ("accuracy", "macro_f1", "human_required_recall", "false_automation_rate")]
    x = np.arange(len(metrics))
    width = 0.36
    figure, axes = plt.subplots(1, 2, figsize=(16, 6.5), constrained_layout=True)
    figure.suptitle("Risk-oversampled Review Bias", fontsize=17, fontweight="bold")
    for offset, strategy, color in ((-width / 2, "naive_50_50", "#DC2626"), (width / 2, "post_stratified", "#059669")):
        selected = [next(row for row in rows if row["strategy"] == strategy and row["metric"] == metric) for metric in metrics]
        axes[0].bar(x + offset, [row["mean_absolute_error"] for row in selected], width, color=color, label=strategy)
        axes[1].bar(x + offset, [row["p95_absolute_error"] for row in selected], width, color=color, label=strategy)
    for axis, title in ((axes[0], "Mean absolute error"), (axes[1], "p95 absolute error")):
        axis.set_xticks(x, ["Accuracy", "Macro-F1", "Human recall", "False auto"], rotation=10)
        axis.set_ylabel("Absolute error")
        axis.set_title(title, loc="left", fontweight="bold")
        axis.grid(axis="y", alpha=0.2)
        axis.legend(frameon=False)
        axis.spines[["top", "right"]].set_visible(False)
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def _plot_table(path: Path, rows: list[dict[str, Any]]) -> None:
    columns = ["Strategy", "Metric", "Population truth", "Mean abs. error", "p95 abs. error"]
    table_rows = [[row["strategy"], row["metric"], f'{row["true_value"]:.4f}', f'{row["mean_absolute_error"]:.4f}', f'{row["p95_absolute_error"]:.4f}'] for row in rows]
    figure, axis = plt.subplots(figsize=(14.5, 6))
    axis.axis("off")
    table = axis.table(cellText=table_rows, colLabels=columns, cellLoc="center", colLoc="center", loc="center")
    table.auto_set_font_size(False)
    table.set_fontsize(10)
    table.scale(1, 1.65)
    for column in range(len(columns)):
        table[0, column].set_facecolor("#1F2937")
        table[0, column].set_text_props(color="white", fontweight="bold")
    for row_index, row in enumerate(rows, start=1):
        color = "#F0FDF4" if row["strategy"] == "post_stratified" else "#FEF2F2"
        for column in range(len(columns)):
            table[row_index, column].set_facecolor(color)
    figure.suptitle("50:50 Review Sample vs 90:10 Production Traffic", fontsize=16, fontweight="bold")
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)
