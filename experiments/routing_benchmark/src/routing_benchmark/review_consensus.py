from __future__ import annotations

import csv
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np

plt.switch_backend("Agg")

TOTAL_LABELS = 11_000
RISK_FRACTION = 0.50
TARGET_LABEL_ERROR = 0.01
NATURAL_DUAL_FRACTIONS = (0.0, 0.10, 0.25, 0.50, 0.75, 1.0)
RISK_DUAL_FRACTIONS = (0.0, 0.50, 1.0)
ERROR_SCENARIOS = {
    "optimistic": {"natural": 0.01, "risk": 0.05},
    "expected": {"natural": 0.02, "risk": 0.08},
    "stressed": {"natural": 0.05, "risk": 0.15}
}


def _stratum_trial(samples: int, reviewer_error: float, dual_fraction: float,
                    trials: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    dual = round(samples * dual_fraction)
    single = samples - dual
    single_errors = rng.binomial(single, reviewer_error, size=trials)
    wrong_agreement = reviewer_error * reviewer_error / 4
    correct_agreement = (1 - reviewer_error) ** 2
    disagreement = 1 - correct_agreement - wrong_agreement
    outcomes = rng.multinomial(dual, [correct_agreement, wrong_agreement, disagreement], size=trials)
    errors = single_errors + outcomes[:, 1]
    reviews = np.full(trials, single + dual * 2) + outcomes[:, 2]
    adjudications = outcomes[:, 2]
    return errors, reviews, adjudications


def evaluate_strategy(natural_error: float, risk_error: float, natural_dual: float,
                      risk_dual: float, trials: int, seed: int) -> dict[str, float]:
    natural_samples = round(TOTAL_LABELS * (1 - RISK_FRACTION))
    risk_samples = TOTAL_LABELS - natural_samples
    rng = np.random.default_rng(seed)
    natural = _stratum_trial(natural_samples, natural_error, natural_dual, trials, rng)
    risk = _stratum_trial(risk_samples, risk_error, risk_dual, trials, rng)
    errors = natural[0] + risk[0]
    reviews = natural[1] + risk[1]
    adjudications = natural[2] + risk[2]
    return {
        "natural_dual_fraction": natural_dual,
        "risk_dual_fraction": risk_dual,
        "mean_label_error_rate": float(np.mean(errors / TOTAL_LABELS)),
        "p95_label_error_rate": float(np.quantile(errors / TOTAL_LABELS, 0.95)),
        "mean_reviews_per_gold_label": float(np.mean(reviews / TOTAL_LABELS)),
        "mean_adjudication_rate": float(np.mean(adjudications / TOTAL_LABELS))
    }


def evaluate_review_consensus(output_dir: Path, trials: int = 5_000, seed: int = 20260827) -> list[Path]:
    results: dict[str, list[dict[str, float]]] = {}
    selected: list[dict[str, Any]] = []
    for scenario_index, (name, errors) in enumerate(ERROR_SCENARIOS.items()):
        strategies = [
            evaluate_strategy(
                errors["natural"], errors["risk"], natural_dual, risk_dual,
                trials, seed + scenario_index * 100_000 + natural_index * 100 + risk_index
            )
            for natural_index, natural_dual in enumerate(NATURAL_DUAL_FRACTIONS)
            for risk_index, risk_dual in enumerate(RISK_DUAL_FRACTIONS)
        ]
        results[name] = strategies
        eligible = [row for row in strategies if row["p95_label_error_rate"] <= TARGET_LABEL_ERROR]
        choice = min(eligible, key=lambda row: row["mean_reviews_per_gold_label"])
        selected.append({
            "scenario": name,
            "natural_reviewer_error": errors["natural"],
            "risk_reviewer_error": errors["risk"],
            **choice
        })
    payload = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "method": {
            "labels": TOTAL_LABELS,
            "risk_fraction": RISK_FRACTION,
            "trials_per_strategy": trials,
            "seed": seed,
            "wrong_label_assumption": "uniform across the other four routes",
            "adjudicator_assumption": "resolves every disagreement correctly",
            "selection_gate": "p95 accepted-label error <= 1%"
        },
        "selected": selected,
        "results": results
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "review_consensus_evaluation.json"
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = output_dir / "review_consensus_selected.csv"
    _write_csv(csv_path, selected)
    dashboard_path = output_dir / "review_consensus_dashboard.png"
    _plot_dashboard(dashboard_path, payload)
    table_path = output_dir / "review_consensus_table.png"
    _plot_table(table_path, selected)
    return [report_path, csv_path, dashboard_path, table_path]


def _write_csv(path: Path, selected: list[dict[str, Any]]) -> None:
    fields = list(selected[0])
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows(selected)


def _plot_dashboard(path: Path, payload: dict[str, Any]) -> None:
    figure, axes = plt.subplots(1, 2, figsize=(16, 6.5), constrained_layout=True)
    figure.suptitle("Risk-weighted Review Consensus Frontier", fontsize=17, fontweight="bold")
    expected = payload["results"]["expected"]
    colors = {0.0: "#DC2626", 0.5: "#F97316", 1.0: "#059669"}
    for risk_dual, color in colors.items():
        rows = [row for row in expected if row["risk_dual_fraction"] == risk_dual]
        axes[0].plot(
            [row["mean_reviews_per_gold_label"] for row in rows],
            [row["p95_label_error_rate"] for row in rows],
            marker="o", color=color, linewidth=2, label=f"risk dual={risk_dual:.0%}"
        )
    axes[0].axhline(TARGET_LABEL_ERROR, color="#111827", linestyle="--", label="1% p95 gate")
    axes[0].set_xlabel("Human reviews per accepted gold label")
    axes[0].set_ylabel("p95 accepted-label error")
    axes[0].set_title("Expected reviewer-error scenario", loc="left", fontweight="bold")
    axes[0].legend(frameon=False)

    selected = payload["selected"]
    x = np.arange(len(selected))
    axes[1].bar(x - 0.18, [row["mean_reviews_per_gold_label"] for row in selected], 0.36,
                color="#2563EB", label="reviews / gold")
    error_axis = axes[1].twinx()
    error_axis.bar(x + 0.18, [row["p95_label_error_rate"] for row in selected], 0.36,
                   color="#059669", label="p95 label error")
    axes[1].set_xticks(x, [row["scenario"] for row in selected])
    axes[1].set_ylabel("Reviews per accepted gold label")
    error_axis.set_ylabel("p95 label error")
    axes[1].set_title("Cheapest strategy passing 1% gate", loc="left", fontweight="bold")
    axes[1].legend(frameon=False, loc="upper left")
    error_axis.legend(frameon=False, loc="upper right")
    for axis in axes:
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(axis="y", alpha=0.2)
        axis.set_axisbelow(True)
    error_axis.spines["top"].set_visible(False)
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def _plot_table(path: Path, selected: list[dict[str, Any]]) -> None:
    columns = ["Scenario", "Natural error", "Risk error", "Natural dual", "Risk dual", "Reviews/gold", "p95 label error"]
    rows = [[
        row["scenario"],
        f'{row["natural_reviewer_error"]:.0%}',
        f'{row["risk_reviewer_error"]:.0%}',
        f'{row["natural_dual_fraction"]:.0%}',
        f'{row["risk_dual_fraction"]:.0%}',
        f'{row["mean_reviews_per_gold_label"]:.2f}',
        f'{row["p95_label_error_rate"]:.2%}'
    ] for row in selected]
    figure, axis = plt.subplots(figsize=(16.5, 4.5))
    axis.axis("off")
    table = axis.table(cellText=rows, colLabels=columns, cellLoc="center", colLoc="center", loc="center")
    table.auto_set_font_size(False)
    table.set_fontsize(10.5)
    table.scale(1, 1.9)
    for column in range(len(columns)):
        table[0, column].set_facecolor("#1F2937")
        table[0, column].set_text_props(color="white", fontweight="bold")
    for row in range(1, len(rows) + 1):
        for column in range(len(columns)):
            table[row, column].set_facecolor("#F0FDF4" if row == 2 else "#F9FAFB")
    figure.suptitle("Review Consensus — Minimum-cost Policies Passing 1% Gate", fontsize=16, fontweight="bold")
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)
