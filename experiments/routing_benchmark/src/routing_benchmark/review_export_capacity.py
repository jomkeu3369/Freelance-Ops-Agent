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

COHORT_SIZES = (10_000, 100_000, 1_000_000)
PAGE_SIZE = 1_000
INITIAL_EVENTS = 10_000
LATE_CAPTURES = 200


def scan_work_rows(cohort_size: int, page_size: int = PAGE_SIZE) -> tuple[int, int]:
    pages = math.ceil(cohort_size / page_size)
    offset_work = sum(min(page_size, cohort_size - page * page_size) + page * page_size for page in range(pages))
    return offset_work, cohort_size


def simulate_cohort_stability(trials: int, seed: int) -> list[dict[str, float | str]]:
    rng = np.random.default_rng(seed)
    pages = math.ceil(INITIAL_EVENTS / PAGE_SIZE)
    missed = []
    included_after_start = []
    for _ in range(trials):
        occurred_bin = np.minimum((rng.random(LATE_CAPTURES) * pages).astype(int), pages - 1)
        captured_after_page = rng.integers(1, pages + 1, size=LATE_CAPTURES)
        included = int(np.sum(captured_after_page <= occurred_bin))
        included_after_start.append(included)
        missed.append(LATE_CAPTURES - included)
    return [
        {
            "strategy": "moving_keyset",
            "mean_rows_outside_start_snapshot": float(np.mean(included_after_start)),
            "mean_final_population_omissions": float(np.mean(missed)),
            "p95_final_population_omissions": float(np.quantile(missed, 0.95)),
            "reproducibility_failure_rate": float(np.mean(np.asarray(included_after_start) > 0))
        },
        {
            "strategy": "fixed_captured_at_snapshot",
            "mean_rows_outside_start_snapshot": 0.0,
            "mean_final_population_omissions": 0.0,
            "p95_final_population_omissions": 0.0,
            "reproducibility_failure_rate": 0.0
        }
    ]


def evaluate_review_export_capacity(output_dir: Path, trials: int = 2_000, seed: int = 20260827) -> list[Path]:
    scan_rows = []
    for cohort_size in COHORT_SIZES:
        offset_work, keyset_work = scan_work_rows(cohort_size)
        scan_rows.append({
            "cohort_size": cohort_size,
            "page_size": PAGE_SIZE,
            "pages": math.ceil(cohort_size / PAGE_SIZE),
            "offset_rows_examined": offset_work,
            "keyset_rows_examined": keyset_work,
            "offset_to_keyset_work_ratio": offset_work / keyset_work
        })
    stability_rows = simulate_cohort_stability(trials, seed)
    payload = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "method": {
            "page_size": PAGE_SIZE,
            "stability_trials": trials,
            "seed": seed,
            "initial_events": INITIAL_EVENTS,
            "late_captures_during_export": LATE_CAPTURES,
            "late_capture_occurrence": "uniform across the cohort window",
            "late_capture_arrival": "uniform after one of the export page reads"
        },
        "scan_work": scan_rows,
        "cohort_stability": stability_rows
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "route_review_export_capacity.json"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = output_dir / "route_review_export_capacity.csv"
    _write_csv(csv_path, scan_rows, stability_rows)
    dashboard_path = output_dir / "route_review_export_capacity_dashboard.png"
    _plot_dashboard(dashboard_path, scan_rows, stability_rows)
    table_path = output_dir / "route_review_export_capacity_table.png"
    _plot_table(table_path, scan_rows, stability_rows)
    return [json_path, csv_path, dashboard_path, table_path]


def _write_csv(path: Path, scan_rows: list[dict[str, Any]], stability_rows: list[dict[str, Any]]) -> None:
    fields = ["category", "name", "value", "unit"]
    rows = []
    for row in scan_rows:
        rows.append({
            "category": "scan_work",
            "name": f'{row["cohort_size"]}_offset_to_keyset_ratio',
            "value": row["offset_to_keyset_work_ratio"],
            "unit": "ratio"
        })
    for row in stability_rows:
        for metric in (
            "mean_rows_outside_start_snapshot",
            "mean_final_population_omissions",
            "p95_final_population_omissions",
            "reproducibility_failure_rate"
        ):
            rows.append({
                "category": "cohort_stability",
                "name": f'{row["strategy"]}_{metric}',
                "value": row[metric],
                "unit": "rate" if metric.endswith("rate") else "rows"
            })
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def _plot_dashboard(path: Path, scan_rows: list[dict[str, Any]], stability_rows: list[dict[str, Any]]) -> None:
    figure, axes = plt.subplots(1, 2, figsize=(16, 6.5), constrained_layout=True)
    figure.suptitle("Fixed-snapshot Route Review Export", fontsize=17, fontweight="bold")
    sizes = [row["cohort_size"] for row in scan_rows]
    axes[0].plot(sizes, [row["offset_to_keyset_work_ratio"] for row in scan_rows], marker="o", linewidth=2.5, color="#2563EB")
    axes[0].set_xscale("log")
    axes[0].set_yscale("log")
    axes[0].set_xlabel("Cohort observations")
    axes[0].set_ylabel("Offset / keyset rows-examined ratio")
    axes[0].set_title("Pagination scan work", loc="left", fontweight="bold")
    strategies = [row["strategy"].replace("_", " ") for row in stability_rows]
    x = np.arange(len(strategies))
    width = 0.34
    axes[1].bar(x - width / 2, [row["mean_rows_outside_start_snapshot"] for row in stability_rows], width, color="#DC2626", label="rows outside start snapshot")
    axes[1].bar(x + width / 2, [row["mean_final_population_omissions"] for row in stability_rows], width, color="#F59E0B", label="final-population omissions")
    axes[1].set_xticks(x, strategies, rotation=8)
    axes[1].set_ylabel("Mean rows per export")
    axes[1].set_title("200 late captures during 10-page export", loc="left", fontweight="bold")
    axes[1].legend(frameon=False)
    for axis in axes:
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(axis="y", alpha=0.2)
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def _plot_table(path: Path, scan_rows: list[dict[str, Any]], stability_rows: list[dict[str, Any]]) -> None:
    columns = ["Category", "Scenario", "Key result", "Interpretation"]
    rows = [
        [
            "Scan work",
            f'{row["cohort_size"]:,} rows / {row["pages"]:,} pages',
            f'{row["offset_to_keyset_work_ratio"]:.1f}x',
            "offset work relative to keyset"
        ]
        for row in scan_rows
    ]
    for row in stability_rows:
        rows.append([
            "Cohort stability",
            row["strategy"].replace("_", " "),
            f'{row["mean_final_population_omissions"]:.1f} omitted; {row["mean_rows_outside_start_snapshot"]:.1f} late',
            f'{row["reproducibility_failure_rate"]:.1%} non-reproducible'
        ])
    figure, axis = plt.subplots(figsize=(16.5, 5.2))
    axis.axis("off")
    table = axis.table(cellText=rows, colLabels=columns, cellLoc="center", colLoc="center", loc="center", colWidths=[0.18, 0.27, 0.25, 0.30])
    table.auto_set_font_size(False)
    table.set_fontsize(10.5)
    table.scale(1, 1.85)
    for column in range(len(columns)):
        table[0, column].set_facecolor("#1F2937")
        table[0, column].set_text_props(color="white", fontweight="bold")
    for row_index in range(1, len(rows) + 1):
        color = "#F0FDF4" if "fixed" in rows[row_index - 1][1] else "#F9FAFB"
        for column in range(len(columns)):
            table[row_index, column].set_facecolor(color)
    figure.suptitle("Route Review Export — Scan Efficiency and Snapshot Stability", fontsize=16, fontweight="bold")
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)
