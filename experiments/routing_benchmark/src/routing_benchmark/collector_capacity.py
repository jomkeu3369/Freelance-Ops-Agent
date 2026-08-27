from __future__ import annotations

import csv
import json
import math
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np

plt.switch_backend("Agg")

BATCH_SIZE = 20
FIXED_DELAY_SECONDS = 1.0
HORIZON_SECONDS = 3_600.0
CONCURRENCY_LEVELS = (1, 4, 8, 20)
LATENCY_MILLISECONDS = (50, 100, 250, 500)
ARRIVALS_PER_MINUTE = (50, 100, 200, 400)


def theoretical_capacity_per_minute(concurrency: int, latency_ms: int) -> float:
    processing_seconds = math.ceil(BATCH_SIZE / concurrency) * latency_ms / 1_000
    return BATCH_SIZE / (FIXED_DELAY_SECONDS + processing_seconds) * 60


def simulate_collector(concurrency: int, latency_ms: int, arrivals_per_minute: int) -> dict[str, float | int]:
    interval = 60 / arrivals_per_minute
    arrivals = [index * interval for index in range(math.ceil(HORIZON_SECONDS / interval))]
    arrivals = [arrival for arrival in arrivals if arrival < HORIZON_SECONDS]
    pending: deque[float] = deque()
    arrival_index = 0
    cycle_start = 0.0
    completed_by_horizon = 0
    delays: list[float] = []

    while cycle_start < HORIZON_SECONDS:
        while arrival_index < len(arrivals) and arrivals[arrival_index] <= cycle_start:
            pending.append(arrivals[arrival_index])
            arrival_index += 1
        claimed = min(BATCH_SIZE, len(pending))
        if claimed == 0:
            cycle_start += FIXED_DELAY_SECONDS
            continue
        completion = cycle_start + math.ceil(claimed / concurrency) * latency_ms / 1_000
        for _ in range(claimed):
            arrival = pending.popleft()
            if completion <= HORIZON_SECONDS:
                delays.append(completion - arrival)
                completed_by_horizon += 1
        cycle_start = completion + FIXED_DELAY_SECONDS

    backlog = len(arrivals) - completed_by_horizon
    return {
        "concurrency": concurrency,
        "request_latency_ms": latency_ms,
        "arrivals_per_minute": arrivals_per_minute,
        "theoretical_capacity_per_minute": theoretical_capacity_per_minute(concurrency, latency_ms),
        "completed_in_hour": completed_by_horizon,
        "backlog_after_hour": backlog,
        "p95_collection_delay_seconds": float(np.quantile(delays, 0.95)) if delays else 0.0,
        "stable": backlog <= BATCH_SIZE
    }


def evaluate_collector_capacity(output_dir: Path) -> list[Path]:
    results = [
        simulate_collector(concurrency, latency_ms, arrivals)
        for concurrency in CONCURRENCY_LEVELS
        for latency_ms in LATENCY_MILLISECONDS
        for arrivals in ARRIVALS_PER_MINUTE
    ]
    payload = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "implementation_model": {
            "batch_size": BATCH_SIZE,
            "fixed_delay_seconds": FIXED_DELAY_SECONDS,
            "horizon_seconds": HORIZON_SECONDS,
            "claim_strategy": "up to 20 durable queue rows per scheduler cycle",
            "execution_strategy": "one virtual thread per claimed run, bounded by batch size"
        },
        "results": results
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "route_collector_capacity.json"
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = output_dir / "route_collector_capacity.csv"
    _write_csv(csv_path, results)
    dashboard_path = output_dir / "route_collector_capacity_dashboard.png"
    _plot_dashboard(dashboard_path, results)
    table_path = output_dir / "route_collector_capacity_table.png"
    _plot_table(table_path)
    return [report_path, csv_path, dashboard_path, table_path]


def _write_csv(path: Path, results: list[dict[str, Any]]) -> None:
    fields = list(results[0])
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows(results)


def _plot_dashboard(path: Path, results: list[dict[str, Any]]) -> None:
    figure, axes = plt.subplots(1, 2, figsize=(16, 6.5), constrained_layout=True)
    figure.suptitle("Durable Route Observation Collector Capacity", fontsize=17, fontweight="bold")
    colors = ("#DC2626", "#F97316", "#2563EB", "#059669")
    for concurrency, color in zip(CONCURRENCY_LEVELS, colors):
        capacities = [theoretical_capacity_per_minute(concurrency, latency) for latency in LATENCY_MILLISECONDS]
        axes[0].plot(LATENCY_MILLISECONDS, capacities, marker="o", linewidth=2, color=color, label=f"concurrency={concurrency}")
    axes[0].axhline(max(ARRIVALS_PER_MINUTE), color="#111827", linestyle="--", label="400 arrivals/min")
    axes[0].set_xlabel("Agent snapshot request latency (ms)")
    axes[0].set_ylabel("Theoretical collection capacity / min")
    axes[0].set_title("Virtual-thread batch concurrency", loc="left", fontweight="bold")
    axes[0].legend(frameon=False)

    worst_case = [result for result in results if result["request_latency_ms"] == 500]
    width = 0.19
    x = np.arange(len(ARRIVALS_PER_MINUTE))
    for index, (concurrency, color) in enumerate(zip(CONCURRENCY_LEVELS, colors)):
        values = [
            result["backlog_after_hour"]
            for arrivals in ARRIVALS_PER_MINUTE
            for result in worst_case
            if result["arrivals_per_minute"] == arrivals and result["concurrency"] == concurrency
        ]
        axes[1].bar(x + (index - 1.5) * width, values, width, color=color, label=f"concurrency={concurrency}")
    axes[1].set_xticks(x, [str(value) for value in ARRIVALS_PER_MINUTE])
    axes[1].set_xlabel("Incoming completed runs / min")
    axes[1].set_ylabel("Uncollected observations after 1 hour")
    axes[1].set_yscale("symlog", linthresh=20)
    axes[1].set_title("500 ms snapshot latency — backlog", loc="left", fontweight="bold")
    axes[1].legend(frameon=False)
    for axis in axes:
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(axis="y", alpha=0.2)
        axis.set_axisbelow(True)
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def _plot_table(path: Path) -> None:
    columns = ["Concurrency", *(f"{latency} ms" for latency in LATENCY_MILLISECONDS)]
    rows = [[
        str(concurrency),
        *(f"{theoretical_capacity_per_minute(concurrency, latency):,.0f}/min" for latency in LATENCY_MILLISECONDS)
    ] for concurrency in CONCURRENCY_LEVELS]
    figure, axis = plt.subplots(figsize=(13.5, 4.5))
    axis.axis("off")
    table = axis.table(cellText=rows, colLabels=columns, cellLoc="center", colLoc="center", loc="center")
    table.auto_set_font_size(False)
    table.set_fontsize(11)
    table.scale(1, 1.9)
    for column in range(len(columns)):
        table[0, column].set_facecolor("#1F2937")
        table[0, column].set_text_props(color="white", fontweight="bold")
    for row in range(1, len(rows) + 1):
        for column in range(len(columns)):
            table[row, column].set_facecolor("#F0FDF4" if row == len(rows) else "#F9FAFB")
    figure.suptitle("Collector Capacity by Snapshot Latency", fontsize=16, fontweight="bold")
    figure.text(0.5, 0.08, "20 claims/cycle · 1 second fixed delay · capacity values are runs/min", ha="center")
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)
