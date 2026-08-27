from __future__ import annotations

import csv
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np

from .operational_replay import ROUTES

plt.switch_backend("Agg")

SCENARIOS = {
    "balanced": (0.20, 0.20, 0.20, 0.20, 0.20),
    "expected_mix": (0.30, 0.30, 0.10, 0.20, 0.10),
    "sparse_risk_routes": (0.35, 0.35, 0.05, 0.20, 0.05)
}
DAILY_REVIEW_RATES = (25, 50, 100, 200)


def _zero_error_wilson_upper(total: np.ndarray, z: float = 1.959963984540054) -> np.ndarray:
    return np.where(total > 0, z * z / (total + z * z), 1.0)


def _pass_probability(total_reviews: int, priors: tuple[float, ...], trials: int, rng: np.random.Generator) -> float:
    total_groups = math.ceil(total_reviews / 4)
    holdout_groups = rng.binomial(total_groups, 0.20, size=trials)
    holdout_samples = np.minimum(total_reviews, holdout_groups * 4)
    route_counts = np.vstack([rng.multinomial(int(sample_count), priors) for sample_count in holdout_samples])
    human_counts = route_counts[:, ROUTES.index("HUMAN_REQUIRED")]
    passes = (
        (holdout_samples >= 1_000)
        & (holdout_groups >= 50)
        & np.all(route_counts >= 100, axis=1)
        & (_zero_error_wilson_upper(human_counts) <= 0.01)
    )
    return float(np.mean(passes))


def plan_collection(output_dir: Path, trials: int = 2_000, seed: int = 20260827) -> list[Path]:
    review_counts = list(range(1_000, 50_001, 500))
    curves: dict[str, list[dict[str, float | int]]] = {}
    summaries: list[dict[str, Any]] = []
    for scenario_index, (name, priors) in enumerate(SCENARIOS.items()):
        rng = np.random.default_rng(seed + scenario_index)
        points = [
            {"total_reviews": total, "structural_gate_probability": _pass_probability(total, priors, trials, rng)}
            for total in review_counts
        ]
        curves[name] = points
        eligible = [int(point["total_reviews"]) for point in points if float(point["structural_gate_probability"]) >= 0.95]
        required = eligible[0] if eligible else None
        summaries.append({
            "scenario": name,
            "route_priors": dict(zip(ROUTES, priors)),
            "minimum_reviews_for_95pct_structural_gate": required,
            "estimated_days": {
                str(rate): math.ceil(required / rate) if required is not None else None
                for rate in DAILY_REVIEW_RATES
            }
        })
    payload = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "method": {
            "monte_carlo_trials_per_point": trials,
            "seed": seed,
            "group_holdout_rate": 0.20,
            "mean_observations_per_group_assumption": 4,
            "structural_gate": "holdout >=1000, groups >=50, each route >=100, zero-error false-automation Wilson upper <=1%",
            "quality_assumption": "planning assumes zero false automation; measured F1 and recall gates remain separate"
        },
        "summaries": summaries,
        "curves": curves
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "shadow_collection_plan.json"
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = output_dir / "shadow_collection_plan.csv"
    _write_csv(csv_path, summaries)
    dashboard_path = output_dir / "shadow_collection_plan_dashboard.png"
    _plot_dashboard(dashboard_path, payload)
    table_path = output_dir / "shadow_collection_plan_table.png"
    _plot_table(table_path, summaries)
    return [report_path, csv_path, dashboard_path, table_path]


def _write_csv(path: Path, summaries: list[dict[str, Any]]) -> None:
    fields = ["scenario", "minimum_reviews_for_95pct_structural_gate", *(f"days_at_{rate}_reviews_per_day" for rate in DAILY_REVIEW_RATES)]
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for summary in summaries:
            writer.writerow({
                "scenario": summary["scenario"],
                "minimum_reviews_for_95pct_structural_gate": summary["minimum_reviews_for_95pct_structural_gate"],
                **{
                    f"days_at_{rate}_reviews_per_day": summary["estimated_days"][str(rate)]
                    for rate in DAILY_REVIEW_RATES
                }
            })


def _plot_dashboard(path: Path, payload: dict[str, Any]) -> None:
    figure, axes = plt.subplots(1, 2, figsize=(16, 6.5), constrained_layout=True)
    figure.suptitle("Shadow Review Collection Capacity Plan", fontsize=17, fontweight="bold")
    colors = ("#2563EB", "#7C3AED", "#DC2626")
    for color, summary in zip(colors, payload["summaries"]):
        points = payload["curves"][summary["scenario"]]
        axes[0].plot(
            [point["total_reviews"] for point in points],
            [point["structural_gate_probability"] for point in points],
            label=summary["scenario"], color=color, linewidth=2
        )
    axes[0].axhline(0.95, color="#111827", linestyle="--", linewidth=1.5, label="95% target")
    axes[0].set_xlabel("Total human-reviewed observations")
    axes[0].set_ylabel("P(structural gate passes)")
    axes[0].set_ylim(0, 1.02)
    axes[0].legend(frameon=False)
    axes[0].set_title("Grouped-holdout evidence availability", loc="left", fontweight="bold")

    width = 0.22
    positions = np.arange(len(DAILY_REVIEW_RATES))
    for index, (color, summary) in enumerate(zip(colors, payload["summaries"])):
        values = [summary["estimated_days"][str(rate)] for rate in DAILY_REVIEW_RATES]
        axes[1].bar(positions + (index - 1) * width, values, width, label=summary["scenario"], color=color)
    axes[1].set_xticks(positions, [str(rate) for rate in DAILY_REVIEW_RATES])
    axes[1].set_xlabel("Human reviews per day")
    axes[1].set_ylabel("Calendar days")
    axes[1].set_title("Time to 95% structural-gate probability", loc="left", fontweight="bold")
    axes[1].legend(frameon=False)
    for axis in axes:
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(axis="y", alpha=0.2)
        axis.set_axisbelow(True)
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def _plot_table(path: Path, summaries: list[dict[str, Any]]) -> None:
    columns = ["Traffic scenario", "Required reviews", *(f"{rate}/day" for rate in DAILY_REVIEW_RATES)]
    rows = [[
        summary["scenario"],
        f'{summary["minimum_reviews_for_95pct_structural_gate"]:,}',
        *(f'{summary["estimated_days"][str(rate)]:,} days' for rate in DAILY_REVIEW_RATES)
    ] for summary in summaries]
    figure, axis = plt.subplots(figsize=(15, 4.2))
    axis.axis("off")
    table = axis.table(cellText=rows, colLabels=columns, cellLoc="center", colLoc="center", loc="center", colWidths=[0.25, 0.17, 0.13, 0.13, 0.13, 0.13])
    table.auto_set_font_size(False)
    table.set_fontsize(10)
    table.scale(1, 1.9)
    for column in range(len(columns)):
        table[0, column].set_facecolor("#1F2937")
        table[0, column].set_text_props(color="white", fontweight="bold")
    for row in range(1, len(rows) + 1):
        for column in range(len(columns)):
            table[row, column].set_facecolor("#F0FDF4" if row % 2 else "#F9FAFB")
    figure.suptitle("Shadow Review Collection — 95% Structural Gate Plan", fontsize=16, fontweight="bold")
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)
