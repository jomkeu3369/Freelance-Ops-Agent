from __future__ import annotations

import csv
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np

from .collection_planning import DAILY_REVIEW_RATES, _zero_error_wilson_upper
from .operational_replay import ROUTES

plt.switch_backend("Agg")

NATURAL_PRIORS = (0.35, 0.35, 0.05, 0.20, 0.05)
RISK_STRATUM_PRIORS = (0.025, 0.025, 0.45, 0.05, 0.45)
STRATEGIES = {
    "natural_only": 1.0,
    "70pct_natural_30pct_risk": 0.70,
    "50pct_natural_50pct_risk": 0.50,
    "30pct_natural_70pct_risk": 0.30
}


def _strategy_probability(total_reviews: int, natural_fraction: float, trials: int, rng: np.random.Generator) -> float:
    natural_reviews = round(total_reviews * natural_fraction)
    risk_reviews = total_reviews - natural_reviews
    natural_holdout_groups = rng.binomial(math.ceil(natural_reviews / 4), 0.20, size=trials)
    risk_holdout_groups = rng.binomial(math.ceil(risk_reviews / 4), 0.20, size=trials)
    natural_samples = np.minimum(natural_reviews, natural_holdout_groups * 4)
    risk_samples = np.minimum(risk_reviews, risk_holdout_groups * 4)
    natural_counts = np.vstack([rng.multinomial(int(count), NATURAL_PRIORS) for count in natural_samples])
    risk_counts = np.vstack([rng.multinomial(int(count), RISK_STRATUM_PRIORS) for count in risk_samples])
    route_counts = natural_counts + risk_counts
    human_counts = route_counts[:, ROUTES.index("HUMAN_REQUIRED")]
    passes = (
        (natural_samples >= 1_000)
        & ((natural_holdout_groups + risk_holdout_groups) >= 50)
        & np.all(route_counts >= 100, axis=1)
        & (_zero_error_wilson_upper(human_counts) <= 0.01)
    )
    return float(np.mean(passes))


def evaluate_review_sampling(output_dir: Path, trials: int = 2_000, seed: int = 20260827) -> list[Path]:
    counts = list(range(5_000, 50_001, 500))
    curves: dict[str, list[dict[str, float | int]]] = {}
    summaries: list[dict[str, Any]] = []
    for index, (name, natural_fraction) in enumerate(STRATEGIES.items()):
        rng = np.random.default_rng(seed + index)
        points = [
            {"total_reviews": count, "gate_probability": _strategy_probability(count, natural_fraction, trials, rng)}
            for count in counts
        ]
        curves[name] = points
        required = next((int(point["total_reviews"]) for point in points if float(point["gate_probability"]) >= 0.95), None)
        summaries.append({
            "strategy": name,
            "natural_fraction": natural_fraction,
            "risk_stratum_fraction": 1 - natural_fraction,
            "minimum_reviews_for_95pct_gate": required,
            "estimated_days": {
                str(rate): math.ceil(required / rate) if required is not None else None
                for rate in DAILY_REVIEW_RATES
            }
        })
    baseline = int(summaries[0]["minimum_reviews_for_95pct_gate"])
    for summary in summaries:
        summary["review_reduction_vs_natural"] = 1 - int(summary["minimum_reviews_for_95pct_gate"]) / baseline
    payload = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "method": {
            "trials_per_point": trials,
            "seed": seed,
            "natural_traffic_priors": dict(zip(ROUTES, NATURAL_PRIORS)),
            "risk_stratum_priors": dict(zip(ROUTES, RISK_STRATUM_PRIORS)),
            "natural_holdout_minimum": 1_000,
            "warning": "traffic-weighted quality and cost must be estimated from the natural stratum only"
        },
        "summaries": summaries,
        "curves": curves
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "review_sampling_evaluation.json"
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = output_dir / "review_sampling_summary.csv"
    _write_csv(csv_path, summaries)
    dashboard_path = output_dir / "review_sampling_dashboard.png"
    _plot_dashboard(dashboard_path, payload)
    table_path = output_dir / "review_sampling_table.png"
    _plot_table(table_path, summaries)
    return [report_path, csv_path, dashboard_path, table_path]


def _write_csv(path: Path, summaries: list[dict[str, Any]]) -> None:
    fields = ["strategy", "natural_fraction", "risk_stratum_fraction", "minimum_reviews_for_95pct_gate", "review_reduction_vs_natural", *(f"days_at_{rate}_reviews_per_day" for rate in DAILY_REVIEW_RATES)]
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for summary in summaries:
            writer.writerow({
                **{field: summary[field] for field in fields[:5]},
                **{f"days_at_{rate}_reviews_per_day": summary["estimated_days"][str(rate)] for rate in DAILY_REVIEW_RATES}
            })


def _plot_dashboard(path: Path, payload: dict[str, Any]) -> None:
    figure, axes = plt.subplots(1, 2, figsize=(16, 6.5), constrained_layout=True)
    figure.suptitle("Risk-stratified Shadow Review Sampling", fontsize=17, fontweight="bold")
    colors = ("#DC2626", "#F97316", "#059669", "#2563EB")
    for color, summary in zip(colors, payload["summaries"]):
        points = payload["curves"][summary["strategy"]]
        axes[0].plot([point["total_reviews"] for point in points], [point["gate_probability"] for point in points], label=summary["strategy"], color=color, linewidth=2)
    axes[0].axhline(0.95, color="#111827", linestyle="--", linewidth=1.5)
    axes[0].set_xlabel("Total human-reviewed observations")
    axes[0].set_ylabel("P(evidence gate passes)")
    axes[0].set_ylim(0, 1.02)
    axes[0].set_title("Natural + risk-stratum allocation", loc="left", fontweight="bold")
    axes[0].legend(frameon=False, fontsize=9)

    names = [summary["strategy"].replace("pct_", "/").replace("_", " ") for summary in payload["summaries"]]
    required = [summary["minimum_reviews_for_95pct_gate"] for summary in payload["summaries"]]
    bars = axes[1].bar(names, required, color=colors)
    axes[1].bar_label(bars, labels=[f"{value:,}" for value in required], padding=3)
    axes[1].tick_params(axis="x", rotation=15)
    axes[1].set_ylabel("Required reviews")
    axes[1].set_title("95% evidence-gate threshold", loc="left", fontweight="bold")
    for axis in axes:
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(axis="y", alpha=0.2)
        axis.set_axisbelow(True)
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def _plot_table(path: Path, summaries: list[dict[str, Any]]) -> None:
    columns = ["Review allocation", "Required", "Reduction", "50/day", "100/day", "200/day"]
    rows = [[
        summary["strategy"],
        f'{summary["minimum_reviews_for_95pct_gate"]:,}',
        f'{summary["review_reduction_vs_natural"]:.1%}',
        *(f'{summary["estimated_days"][str(rate)]} days' for rate in (50, 100, 200))
    ] for summary in summaries]
    figure, axis = plt.subplots(figsize=(16, 4.7))
    axis.axis("off")
    table = axis.table(cellText=rows, colLabels=columns, cellLoc="center", colLoc="center", loc="center", colWidths=[0.31, 0.14, 0.13, 0.13, 0.13, 0.13])
    table.auto_set_font_size(False)
    table.set_fontsize(10)
    table.scale(1, 1.9)
    for column in range(len(columns)):
        table[0, column].set_facecolor("#1F2937")
        table[0, column].set_text_props(color="white", fontweight="bold")
    for row in range(1, len(rows) + 1):
        for column in range(len(columns)):
            table[row, column].set_facecolor("#F0FDF4" if row % 2 else "#F9FAFB")
    figure.suptitle("Risk-stratified Review Allocation — Evidence Gate", fontsize=16, fontweight="bold")
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)
