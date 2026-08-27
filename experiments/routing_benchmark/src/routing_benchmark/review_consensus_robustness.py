from __future__ import annotations

import csv
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np

from .review_consensus import (
    NATURAL_DUAL_FRACTIONS,
    RISK_FRACTION,
    TARGET_LABEL_ERROR,
    TOTAL_LABELS,
)

plt.switch_backend("Agg")

AUDIT_FRACTIONS = (0.0, 0.05, 0.10, 0.25, 0.50, 1.0)
ROBUSTNESS_SCENARIOS = {
    "independent": {"natural": 0.02, "risk": 0.08, "natural_common": 0.0, "risk_common": 0.0, "adjudicator": 0.005},
    "expected_shared": {"natural": 0.02, "risk": 0.08, "natural_common": 0.10, "risk_common": 0.25, "adjudicator": 0.005},
    "stressed_shared": {"natural": 0.05, "risk": 0.15, "natural_common": 0.25, "risk_common": 0.50, "adjudicator": 0.0075}
}


def _robust_stratum_trial(samples: int, reviewer_error: float, dual_fraction: float, common_error_fraction: float, audit_fraction: float, adjudicator_error: float, trials: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    dual = round(samples * dual_fraction)
    single = samples - dual
    single_errors = rng.binomial(single, reviewer_error, size=trials)
    common_wrong = reviewer_error * common_error_fraction
    residual_error = (reviewer_error - common_wrong) / (1 - common_wrong)
    independent_share = 1 - common_wrong
    correct_agreement = independent_share * (1 - residual_error) ** 2
    wrong_agreement = common_wrong + independent_share * residual_error**2 / 4
    disagreement = 1 - correct_agreement - wrong_agreement
    probabilities = [
        correct_agreement * (1 - audit_fraction),
        correct_agreement * audit_fraction,
        wrong_agreement * (1 - audit_fraction),
        wrong_agreement * audit_fraction,
        disagreement
    ]
    outcomes = rng.multinomial(dual, probabilities, size=trials)
    adjudicated = outcomes[:, 1] + outcomes[:, 3] + outcomes[:, 4]
    adjudicator_errors = rng.binomial(adjudicated, adjudicator_error)
    errors = single_errors + outcomes[:, 2] + adjudicator_errors
    reviews = np.full(trials, single + dual * 2) + adjudicated
    return errors, reviews, adjudicated


def evaluate_robust_strategy(natural_error: float, risk_error: float, natural_common: float, risk_common: float, adjudicator_error: float, natural_dual: float, natural_audit: float, risk_audit: float, trials: int, seed: int) -> dict[str, float]:
    natural_samples = round(TOTAL_LABELS * (1 - RISK_FRACTION))
    risk_samples = TOTAL_LABELS - natural_samples
    rng = np.random.default_rng(seed)
    natural = _robust_stratum_trial(natural_samples, natural_error, natural_dual, natural_common, natural_audit, adjudicator_error, trials, rng)
    risk = _robust_stratum_trial(risk_samples, risk_error, 1.0, risk_common, risk_audit, adjudicator_error, trials, rng)
    errors = natural[0] + risk[0]
    reviews = natural[1] + risk[1]
    adjudications = natural[2] + risk[2]
    return {
        "natural_dual_fraction": natural_dual,
        "risk_dual_fraction": 1.0,
        "natural_audit_fraction": natural_audit,
        "risk_audit_fraction": risk_audit,
        "mean_label_error_rate": float(np.mean(errors / TOTAL_LABELS)),
        "p95_label_error_rate": float(np.quantile(errors / TOTAL_LABELS, 0.95)),
        "mean_reviews_per_gold_label": float(np.mean(reviews / TOTAL_LABELS)),
        "mean_adjudication_rate": float(np.mean(adjudications / TOTAL_LABELS))
    }


def evaluate_consensus_robustness(output_dir: Path, trials: int = 5_000, seed: int = 20260827) -> list[Path]:
    results: dict[str, list[dict[str, float]]] = {}
    selected: list[dict[str, Any]] = []
    for scenario_index, (name, values) in enumerate(ROBUSTNESS_SCENARIOS.items()):
        strategies = []
        strategy_index = 0
        for natural_dual in NATURAL_DUAL_FRACTIONS:
            for natural_audit in AUDIT_FRACTIONS:
                for risk_audit in AUDIT_FRACTIONS:
                    strategies.append(evaluate_robust_strategy(values["natural"], values["risk"], values["natural_common"], values["risk_common"], values["adjudicator"], natural_dual, natural_audit, risk_audit, trials, seed + scenario_index * 100_000 + strategy_index))
                    strategy_index += 1
        results[name] = strategies
        eligible = [row for row in strategies if row["p95_label_error_rate"] <= TARGET_LABEL_ERROR]
        choice = min(eligible, key=lambda row: row["mean_reviews_per_gold_label"])
        selected.append({"scenario": name, **values, **choice})
    expected = ROBUSTNESS_SCENARIOS["expected_shared"]
    canary = {
        "scenario": "expected_canary",
        **expected,
        **evaluate_robust_strategy(expected["natural"], expected["risk"], expected["natural_common"], expected["risk_common"], expected["adjudicator"], 0.50, 0.05, 1.0, trials, seed + 900_000)
    }
    reported = [*selected, canary]
    payload = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "method": {
            "labels": TOTAL_LABELS,
            "risk_fraction": RISK_FRACTION,
            "trials_per_strategy": trials,
            "seed": seed,
            "common_error_definition": "fraction of each reviewer marginal error shared as the same wrong route",
            "audit_definition": "senior adjudicator independently decides a random fraction of dual-review agreements",
            "risk_dual_fraction": 1.0,
            "selection_gate": "p95 accepted-label error <= 1%"
        },
        "selected": selected,
        "recommended_canary": canary,
        "results": results
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "review_consensus_robustness.json"
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = output_dir / "review_consensus_robustness_selected.csv"
    _write_csv(csv_path, reported)
    dashboard_path = output_dir / "review_consensus_robustness_dashboard.png"
    _plot_dashboard(dashboard_path, payload)
    table_path = output_dir / "review_consensus_robustness_table.png"
    _plot_table(table_path, reported)
    return [report_path, csv_path, dashboard_path, table_path]


def _write_csv(path: Path, selected: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(selected[0]))
        writer.writeheader()
        writer.writerows(selected)


def _plot_dashboard(path: Path, payload: dict[str, Any]) -> None:
    figure, axes = plt.subplots(1, 2, figsize=(16, 6.5), constrained_layout=True)
    figure.suptitle("Consensus Robustness to Shared Reviewer Errors", fontsize=17, fontweight="bold")
    colors = {0.0: "#DC2626", 0.10: "#F97316", 0.25: "#2563EB", 0.50: "#7C3AED", 1.0: "#059669"}
    expected = payload["results"]["expected_shared"]
    for risk_audit, color in colors.items():
        rows = [row for row in expected if row["risk_audit_fraction"] == risk_audit]
        axes[0].scatter([row["mean_reviews_per_gold_label"] for row in rows], [row["p95_label_error_rate"] for row in rows], s=24, alpha=0.65, color=color, label=f"risk audit={risk_audit:.0%}")
    axes[0].axhline(TARGET_LABEL_ERROR, color="#111827", linestyle="--", label="1% p95 gate")
    axes[0].set_xlabel("Human reviews per accepted gold label")
    axes[0].set_ylabel("p95 accepted-label error")
    axes[0].set_title("Expected shared-error frontier", loc="left", fontweight="bold")
    axes[0].legend(frameon=False, fontsize=8)
    selected = payload["selected"]
    x = np.arange(len(selected))
    axes[1].bar(x - 0.18, [row["mean_reviews_per_gold_label"] for row in selected], 0.36, color="#2563EB", label="reviews / gold")
    error_axis = axes[1].twinx()
    error_axis.bar(x + 0.18, [row["p95_label_error_rate"] for row in selected], 0.36, color="#059669", label="p95 label error")
    axes[1].set_xticks(x, [row["scenario"] for row in selected])
    axes[1].set_ylabel("Reviews per accepted gold label")
    error_axis.set_ylabel("p95 label error")
    axes[1].set_title("Minimum-cost passing policies", loc="left", fontweight="bold")
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
    columns = ["Scenario", "Natural shared", "Risk shared", "Senior error", "Natural dual", "Natural audit", "Risk audit", "Reviews/gold", "p95 error"]
    rows = [[row["scenario"], f'{row["natural_common"]:.0%}', f'{row["risk_common"]:.0%}', f'{row["adjudicator"]:.2%}', f'{row["natural_dual_fraction"]:.0%}', f'{row["natural_audit_fraction"]:.0%}', f'{row["risk_audit_fraction"]:.0%}', f'{row["mean_reviews_per_gold_label"]:.2f}', f'{row["p95_label_error_rate"]:.2%}'] for row in selected]
    figure, axis = plt.subplots(figsize=(18, 4.5))
    axis.axis("off")
    table = axis.table(cellText=rows, colLabels=columns, cellLoc="center", colLoc="center", loc="center")
    table.auto_set_font_size(False)
    table.set_fontsize(10)
    table.scale(1, 1.9)
    for column in range(len(columns)):
        table[0, column].set_facecolor("#1F2937")
        table[0, column].set_text_props(color="white", fontweight="bold")
    for row in range(1, len(rows) + 1):
        for column in range(len(columns)):
            table[row, column].set_facecolor("#F0FDF4" if row == 2 else "#F9FAFB")
    figure.suptitle("Shared-error Robustness — Minimum-cost Policies Passing 1% Gate", fontsize=16, fontweight="bold")
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)
