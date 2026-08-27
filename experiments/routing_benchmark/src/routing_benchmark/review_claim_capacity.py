from __future__ import annotations

import csv
import heapq
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np

plt.switch_backend("Agg")

REVIEWERS = (1, 2, 4, 8)
MEAN_REVIEW_MINUTES = (3, 5, 10)
WORKDAY_MINUTES = 8 * 60
TARGET_REVIEWS = 11_000
STRATEGIES = ("read_then_submit", "leased_skip_locked")


def _duration(mean_minutes: int, rng: np.random.Generator) -> float:
    sigma = 0.35
    mu = math.log(mean_minutes) - sigma * sigma / 2
    return float(rng.lognormal(mu, sigma))


def simulate_review_day(reviewers: int, mean_minutes: int, leased: bool, seed: int) -> dict[str, float | int]:
    rng = np.random.default_rng(seed)
    completed: set[int] = set()
    leased_observations: set[int] = set()
    events: list[tuple[float, int, int]] = []

    def assign(reviewer: int, now: float) -> None:
        observation = 0
        while observation in completed or leased and observation in leased_observations:
            observation += 1
        if leased:
            leased_observations.add(observation)
        completion = now + _duration(mean_minutes, rng)
        heapq.heappush(events, (completion, reviewer, observation))

    for reviewer in range(reviewers):
        assign(reviewer, float(rng.uniform(0, mean_minutes)))

    attempts = 0
    duplicates = 0
    while events:
        completion, reviewer, observation = heapq.heappop(events)
        if completion > WORKDAY_MINUTES:
            break
        attempts += 1
        if observation in completed:
            duplicates += 1
        else:
            completed.add(observation)
        leased_observations.discard(observation)
        assign(reviewer, completion)

    unique = len(completed)
    return {
        "reviewers": reviewers,
        "mean_review_minutes": mean_minutes,
        "strategy": "leased_skip_locked" if leased else "read_then_submit",
        "unique_reviews_per_day": unique,
        "attempts_per_day": attempts,
        "duplicate_work_rate": duplicates / attempts if attempts else 0.0
    }


def evaluate_review_claim_capacity(output_dir: Path, trials: int = 500, seed: int = 20260827) -> list[Path]:
    summaries: list[dict[str, Any]] = []
    for reviewers in REVIEWERS:
        for mean_minutes in MEAN_REVIEW_MINUTES:
            for strategy_index, strategy in enumerate(STRATEGIES):
                rows = [
                    simulate_review_day(
                        reviewers, mean_minutes, strategy == "leased_skip_locked",
                        seed + trial + reviewers * 10_000 + mean_minutes * 100 + strategy_index * 1_000_000
                    )
                    for trial in range(trials)
                ]
                daily = float(np.mean([row["unique_reviews_per_day"] for row in rows]))
                attempts = float(np.mean([row["attempts_per_day"] for row in rows]))
                duplicate_rate = float(np.mean([row["duplicate_work_rate"] for row in rows]))
                summaries.append({
                    "reviewers": reviewers,
                    "mean_review_minutes": mean_minutes,
                    "strategy": strategy,
                    "mean_unique_reviews_per_day": daily,
                    "mean_attempts_per_day": attempts,
                    "mean_duplicate_work_rate": duplicate_rate,
                    "days_to_11000_reviews": math.ceil(TARGET_REVIEWS / daily)
                })
    payload = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "method": {
            "trials_per_scenario": trials,
            "seed": seed,
            "workday_minutes": WORKDAY_MINUTES,
            "review_duration_distribution": "lognormal, sigma=0.35",
            "target_reviews": TARGET_REVIEWS,
            "baseline": "oldest unreviewed row remains visible until POST completes",
            "candidate": "15-minute lease with PostgreSQL FOR UPDATE SKIP LOCKED"
        },
        "summaries": summaries
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "review_claim_capacity.json"
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = output_dir / "review_claim_capacity.csv"
    _write_csv(csv_path, summaries)
    dashboard_path = output_dir / "review_claim_capacity_dashboard.png"
    _plot_dashboard(dashboard_path, summaries)
    table_path = output_dir / "review_claim_capacity_table.png"
    _plot_table(table_path, summaries)
    return [report_path, csv_path, dashboard_path, table_path]


def _write_csv(path: Path, summaries: list[dict[str, Any]]) -> None:
    fields = list(summaries[0])
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows(summaries)


def _five_minute(summaries: list[dict[str, Any]], strategy: str) -> list[dict[str, Any]]:
    return [
        row for row in summaries
        if row["mean_review_minutes"] == 5 and row["strategy"] == strategy
    ]


def _plot_dashboard(path: Path, summaries: list[dict[str, Any]]) -> None:
    baseline = _five_minute(summaries, "read_then_submit")
    leased = _five_minute(summaries, "leased_skip_locked")
    x = np.arange(len(REVIEWERS))
    width = 0.34
    figure, axes = plt.subplots(1, 2, figsize=(15.5, 6.3), constrained_layout=True)
    figure.suptitle("Concurrent Human Review Claim Efficiency", fontsize=17, fontweight="bold")
    axes[0].bar(x - width / 2, [row["mean_unique_reviews_per_day"] for row in baseline], width,
                color="#DC2626", label="read then submit")
    axes[0].bar(x + width / 2, [row["mean_unique_reviews_per_day"] for row in leased], width,
                color="#059669", label="leased + SKIP LOCKED")
    axes[0].set_xticks(x, [str(value) for value in REVIEWERS])
    axes[0].set_xlabel("Concurrent reviewers")
    axes[0].set_ylabel("Unique gold reviews / 8-hour day")
    axes[0].set_title("Mean review time = 5 minutes", loc="left", fontweight="bold")
    axes[0].legend(frameon=False)

    axes[1].plot(REVIEWERS, [row["mean_duplicate_work_rate"] for row in baseline], marker="o",
                 linewidth=2, color="#DC2626", label="read then submit")
    axes[1].plot(REVIEWERS, [row["mean_duplicate_work_rate"] for row in leased], marker="o",
                 linewidth=2, color="#059669", label="leased + SKIP LOCKED")
    axes[1].set_xlabel("Concurrent reviewers")
    axes[1].set_ylabel("Duplicate work rate")
    axes[1].set_ylim(-0.02, 1.0)
    axes[1].set_title("Wasted completed reviews", loc="left", fontweight="bold")
    axes[1].legend(frameon=False)
    for axis in axes:
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(axis="y", alpha=0.2)
        axis.set_axisbelow(True)
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def _plot_table(path: Path, summaries: list[dict[str, Any]]) -> None:
    baseline = _five_minute(summaries, "read_then_submit")
    leased = _five_minute(summaries, "leased_skip_locked")
    columns = ["Reviewers", "Baseline unique/day", "Leased unique/day", "Gain", "Duplicate saved", "Days to 11k items"]
    rows = []
    for old, new in zip(baseline, leased):
        gain = new["mean_unique_reviews_per_day"] / old["mean_unique_reviews_per_day"]
        rows.append([
            str(old["reviewers"]),
            f'{old["mean_unique_reviews_per_day"]:.1f}',
            f'{new["mean_unique_reviews_per_day"]:.1f}',
            f"{gain:.2f}x",
            f'{old["mean_duplicate_work_rate"] - new["mean_duplicate_work_rate"]:.1%}',
            str(new["days_to_11000_reviews"])
        ])
    figure, axis = plt.subplots(figsize=(15.5, 4.7))
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
            table[row, column].set_facecolor("#F0FDF4" if row > 1 else "#F9FAFB")
    figure.suptitle("Review Claim Lease — 5-minute Mean Review", fontsize=16, fontweight="bold")
    figure.savefig(path, dpi=180, bbox_inches="tight")
    plt.close(figure)
