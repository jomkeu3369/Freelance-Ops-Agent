from __future__ import annotations

import csv
import json
from datetime import UTC, datetime
from pathlib import Path
from statistics import NormalDist
from typing import Any

import matplotlib.pyplot as plt
import numpy as np

from .review_canary_power import CONFIDENCE_Z, SAMPLE_SIZES, TARGET_RATE, wilson_bounds

plt.switch_backend("Agg")

TRUE_RATES = (0.005, 0.01, 0.015, 0.02)
LOOKS = len(SAMPLE_SIZES)
STRATA = 2
FAMILY_WISE_LOOKS = LOOKS * STRATA
SPENDING_Z = NormalDist().inv_cdf(1 - 0.05 / (2 * FAMILY_WISE_LOOKS))


def _simulate_paths(true_rate: float, trials: int, rng: np.random.Generator) -> np.ndarray:
    increments = np.diff((0, *SAMPLE_SIZES))
    errors = np.column_stack([rng.binomial(size, true_rate, size=trials) for size in increments])
    return np.cumsum(errors, axis=1)


def _evaluate_policy(paths: np.ndarray, z: float) -> tuple[dict[str, float | int | None], list[dict[str, float | int]]]:
    decisions = np.zeros(paths.shape[0], dtype=np.int8)
    decision_samples = np.zeros(paths.shape[0], dtype=np.int32)
    trajectory: list[dict[str, float | int]] = []
    for index, samples in enumerate(SAMPLE_SIZES):
        lower, upper = wilson_bounds(paths[:, index], samples, z)
        undecided = decisions == 0
        accept = undecided & (upper <= TARGET_RATE)
        reject = undecided & (lower > TARGET_RATE)
        decisions[accept] = 1
        decisions[reject] = -1
        decision_samples[accept | reject] = samples
        trajectory.append({
            "audit_samples": samples,
            "cumulative_accept_probability": float(np.mean(decisions == 1)),
            "cumulative_reject_probability": float(np.mean(decisions == -1)),
            "inconclusive_probability": float(np.mean(decisions == 0))
        })
    decided_samples = decision_samples[decision_samples > 0]
    summary: dict[str, float | int | None] = {
        "accept_probability": float(np.mean(decisions == 1)),
        "reject_probability": float(np.mean(decisions == -1)),
        "inconclusive_probability": float(np.mean(decisions == 0)),
        "median_decision_audits": int(np.median(decided_samples)) if len(decided_samples) else None
    }
    return summary, trajectory


def evaluate_sequential_canary(trials: int, seed: int) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    summaries: list[dict[str, Any]] = []
    trajectories: dict[str, list[dict[str, Any]]] = {}
    rng = np.random.default_rng(seed)
    for true_rate in TRUE_RATES:
        paths = _simulate_paths(true_rate, trials, rng)
        for policy, z in (("naive_repeated_95", CONFIDENCE_Z), ("alpha_spending", SPENDING_Z)):
            summary, trajectory = _evaluate_policy(paths, z)
            row = {"true_overturn_rate": true_rate, "policy": policy, "z": z, **summary}
            summaries.append(row)
            trajectories[f"{true_rate:.4f}:{policy}"] = trajectory
    return summaries, trajectories


def evaluate_review_canary_sequential(output_dir: Path, trials: int = 20_000, seed: int = 20260827) -> list[Path]:
    summaries, trajectories = evaluate_sequential_canary(trials, seed)
    payload = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "method": {
            "trials_per_rate": trials,
            "seed": seed,
            "target_overturn_rate": TARGET_RATE,
            "checkpoints": list(SAMPLE_SIZES),
            "looks": LOOKS,
            "strata": STRATA,
            "family_wise_looks": FAMILY_WISE_LOOKS,
            "naive_z": CONFIDENCE_Z,
            "alpha_spending_z": SPENDING_Z,
            "alpha_spending": "Bonferroni two-sided 5% family-wise error across fixed checkpoints and two strata"
        },
        "summary": summaries,
        "trajectories": trajectories
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "review_canary_sequential.json"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = output_dir / "review_canary_sequential_summary.csv"
    _write_csv(csv_path, summaries)
    dashboard_path = output_dir / "review_canary_sequential_dashboard.png"
    _plot_dashboard(dashboard_path, payload)
    table_path = output_dir / "review_canary_sequential_table.png"
    _plot_table(table_path, summaries)
    return [json_path, csv_path, dashboard_path, table_path]


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def _plot_dashboard(path: Path, payload: dict[str, Any]) -> None:
    figure, axes = plt.subplots(1, 2, figsize=(16, 6.5), constrained_layout=True)
    figure.suptitle("Sequential Canary Decision Safety", fontsize=17, fontweight="bold")
    summary = payload["summary"]
    x = np.arange(len(TRUE_RATES))
    width = 0.36
    for offset, policy, color in ((-width / 2, "naive_repeated_95", "#DC2626"), (width / 2, "alpha_spending", "#059669")):
        rows = [row for row in summary if row["policy"] == policy]
        wrong = [row["reject_probability"] if row["true_overturn_rate"] < TARGET_RATE else row["accept_probability"] if row["true_overturn_rate"] > TARGET_RATE else row["accept_probability"] + row["reject_probability"] for row in rows]
        axes[0].bar(x + offset, wrong, width, color=color, label=policy)
    axes[0].axhline(0.05, color="#111827", linestyle="--", label="5% family-wise error")
    axes[0].set_xticks(x, [f"{rate:.1%}" for rate in TRUE_RATES])
    axes[0].set_ylabel("Wrong / boundary decision probability")
    axes[0].set_xlabel("True consensus overturn rate")
    axes[0].set_title("Repeated-look error", loc="left", fontweight="bold")
    boundary_naive = payload["trajectories"]["0.0100:naive_repeated_95"]
    boundary_safe = payload["trajectories"]["0.0100:alpha_spending"]
    for rows, color, label in ((boundary_naive, "#DC2626", "naive repeated 95%"), (boundary_safe, "#059669", "alpha spending")):
        axes[1].plot([row["audit_samples"] for row in rows], [row["cumulative_accept_probability"] + row["cumulative_reject_probability"] for row in rows], marker="o", color=color, label=label)
    axes[1].axhline(0.05, color="#111827", linestyle="--", label="5% family-wise error")
    axes[1].set_xscale("log")
    axes[1].set_xlabel("Audit checkpoint")
    axes[1].set_ylabel("Cumulative decision probability at 1% boundary")
    axes[1].set_title("Optional-stopping inflation", loc="left", fontweight="bold")
    for axis in axes:
        axis.grid(axis="y", alpha=0.2)
        axis.legend(frameon=False, fontsize=8)
        axis.spines[["top", "right"]].set_visible(False)
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def _plot_table(path: Path, rows: list[dict[str, Any]]) -> None:
    columns = ["True overturn", "Policy", "Accept", "Reject", "Inconclusive", "Median decision N"]
    table_rows = [[f'{row["true_overturn_rate"]:.1%}', "naive 95%" if row["policy"] == "naive_repeated_95" else "alpha spending", f'{row["accept_probability"]:.1%}', f'{row["reject_probability"]:.1%}', f'{row["inconclusive_probability"]:.1%}', "—" if row["median_decision_audits"] is None else str(row["median_decision_audits"])] for row in rows]
    figure, axis = plt.subplots(figsize=(15, 6))
    axis.axis("off")
    table = axis.table(cellText=table_rows, colLabels=columns, cellLoc="center", colLoc="center", loc="center")
    table.auto_set_font_size(False)
    table.set_fontsize(10)
    table.scale(1, 1.65)
    for column in range(len(columns)):
        table[0, column].set_facecolor("#1F2937")
        table[0, column].set_text_props(color="white", fontweight="bold")
    for row_index, row in enumerate(rows, start=1):
        color = "#F0FDF4" if row["policy"] == "alpha_spending" else "#FEF2F2"
        for column in range(len(columns)):
            table[row_index, column].set_facecolor(color)
    figure.suptitle("Sequential Canary Decisions at Fixed Audit Checkpoints", fontsize=16, fontweight="bold")
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)
