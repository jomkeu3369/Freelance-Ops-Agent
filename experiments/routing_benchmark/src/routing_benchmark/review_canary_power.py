from __future__ import annotations

import csv
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np

plt.switch_backend("Agg")

TARGET_RATE = 0.01
CONFIDENCE_Z = 1.959963984540054
SAMPLE_SIZES = (100, 200, 381, 500, 750, 1_000, 1_500, 2_000, 3_000, 5_000, 7_500, 10_000, 15_000, 20_000)
SAFE_RATES = (0.0, 0.001, 0.0025, 0.005)
UNSAFE_RATES = (0.015, 0.02, 0.03)


def wilson_bounds(errors: np.ndarray, total: int, z: float = CONFIDENCE_Z) -> tuple[np.ndarray, np.ndarray]:
    estimate = errors / total
    denominator = 1 + z * z / total
    centre = estimate + z * z / (2 * total)
    radius = z * np.sqrt(estimate * (1 - estimate) / total + z * z / (4 * total * total))
    return (centre - radius) / denominator, (centre + radius) / denominator


def evaluate_canary_power(trials: int, seed: int) -> list[dict[str, float | int | str]]:
    rows: list[dict[str, float | int | str]] = []
    rng = np.random.default_rng(seed)
    for true_rate in (*SAFE_RATES, *UNSAFE_RATES):
        classification = "safe" if true_rate in SAFE_RATES else "unsafe"
        for samples in SAMPLE_SIZES:
            errors = rng.binomial(samples, true_rate, size=trials)
            lower, upper = wilson_bounds(errors, samples)
            accepted = upper <= TARGET_RATE
            rejected = lower > TARGET_RATE
            rows.append({
                "classification": classification,
                "true_overturn_rate": true_rate,
                "audit_samples": samples,
                "accept_probability": float(np.mean(accepted)),
                "reject_probability": float(np.mean(rejected)),
                "inconclusive_probability": float(np.mean(~accepted & ~rejected))
            })
    return rows


def _selected(rows: list[dict[str, float | int | str]]) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for true_rate in (*SAFE_RATES, *UNSAFE_RATES):
        classification = "safe" if true_rate in SAFE_RATES else "unsafe"
        probability_key = "accept_probability" if classification == "safe" else "reject_probability"
        candidates = [row for row in rows if row["true_overturn_rate"] == true_rate and row[probability_key] >= 0.95]
        selected.append({
            "classification": classification,
            "true_overturn_rate": true_rate,
            "decision": "ACCEPT" if classification == "safe" else "REJECT",
            "minimum_audits_for_95_percent_power": candidates[0]["audit_samples"] if candidates else f">{SAMPLE_SIZES[-1]}",
            "days_at_100_audits_per_day": math.ceil(int(candidates[0]["audit_samples"]) / 100) if candidates else None
        })
    return selected


def evaluate_review_canary_power(output_dir: Path, trials: int = 5_000, seed: int = 20260827) -> list[Path]:
    rows = evaluate_canary_power(trials, seed)
    selected = _selected(rows)
    payload = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "method": {
            "trials_per_point": trials,
            "seed": seed,
            "target_overturn_rate": TARGET_RATE,
            "confidence": 0.95,
            "accept_rule": "Wilson 95% upper <= 1%",
            "reject_rule": "Wilson 95% lower > 1%",
            "otherwise": "INCONCLUSIVE"
        },
        "selected": selected,
        "results": rows
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "review_canary_power.json"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = output_dir / "review_canary_power_selected.csv"
    _write_csv(csv_path, selected)
    dashboard_path = output_dir / "review_canary_power_dashboard.png"
    _plot_dashboard(dashboard_path, rows)
    table_path = output_dir / "review_canary_power_table.png"
    _plot_table(table_path, selected)
    return [json_path, csv_path, dashboard_path, table_path]


def _write_csv(path: Path, selected: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(selected[0]))
        writer.writeheader()
        writer.writerows(selected)


def _plot_dashboard(path: Path, rows: list[dict[str, float | int | str]]) -> None:
    figure, axes = plt.subplots(1, 2, figsize=(16, 6.5), constrained_layout=True)
    figure.suptitle("Canary Audit Decision Power", fontsize=17, fontweight="bold")
    colors = ("#059669", "#2563EB", "#7C3AED", "#F97316")
    for true_rate, color in zip(SAFE_RATES, colors):
        points = [row for row in rows if row["true_overturn_rate"] == true_rate]
        axes[0].plot([row["audit_samples"] for row in points], [row["accept_probability"] for row in points], marker="o", color=color, label=f"true={true_rate:.2%}")
    for true_rate, color in zip(UNSAFE_RATES, ("#F97316", "#DC2626", "#7F1D1D")):
        points = [row for row in rows if row["true_overturn_rate"] == true_rate]
        axes[1].plot([row["audit_samples"] for row in points], [row["reject_probability"] for row in points], marker="o", color=color, label=f"true={true_rate:.1%}")
    for axis, title, ylabel in ((axes[0], "Safe policy acceptance", "P(Wilson upper ≤ 1%)"), (axes[1], "Unsafe policy rejection", "P(Wilson lower > 1%)")):
        axis.axhline(0.95, color="#111827", linestyle="--", label="95% power")
        axis.set_xscale("log")
        axis.set_ylim(-0.02, 1.02)
        axis.set_xlabel("Senior audit samples")
        axis.set_ylabel(ylabel)
        axis.set_title(title, loc="left", fontweight="bold")
        axis.grid(alpha=0.2)
        axis.legend(frameon=False, fontsize=8)
        axis.spines[["top", "right"]].set_visible(False)
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def _plot_table(path: Path, selected: list[dict[str, Any]]) -> None:
    columns = ["Class", "True overturn", "Decision", "Audits for 95% power", "Days @100/day"]
    rows = [[row["classification"], f'{row["true_overturn_rate"]:.2%}', row["decision"], str(row["minimum_audits_for_95_percent_power"]), "—" if row["days_at_100_audits_per_day"] is None else str(row["days_at_100_audits_per_day"])] for row in selected]
    figure, axis = plt.subplots(figsize=(13.5, 5.5))
    axis.axis("off")
    table = axis.table(cellText=rows, colLabels=columns, cellLoc="center", colLoc="center", loc="center")
    table.auto_set_font_size(False)
    table.set_fontsize(10.5)
    table.scale(1, 1.75)
    for column in range(len(columns)):
        table[0, column].set_facecolor("#1F2937")
        table[0, column].set_text_props(color="white", fontweight="bold")
    for row_index, row in enumerate(selected, start=1):
        color = "#F0FDF4" if row["classification"] == "safe" else "#FEF2F2"
        for column in range(len(columns)):
            table[row_index, column].set_facecolor(color)
    figure.suptitle("Canary Audit Sample Size for 1% Overturn Gate", fontsize=16, fontweight="bold")
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)
