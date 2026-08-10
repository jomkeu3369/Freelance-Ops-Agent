from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np

plt.switch_backend("Agg")

COLORS = {"A_liquid_encoder": "#2563EB", "B_prompt_llm": "#F97316"}


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _style(axis: Any, title: str, ylabel: str = "") -> None:
    axis.set_title(title, loc="left", fontweight="bold")
    axis.set_ylabel(ylabel)
    axis.spines[["top", "right"]].set_visible(False)
    axis.grid(axis="y", alpha=0.2)
    axis.set_axisbelow(True)


def _bar_labels(axis: Any, digits: int = 3) -> None:
    for container in axis.containers:
        axis.bar_label(container, fmt=f"%.{digits}f", padding=3, fontsize=8)


def plot_router_dashboard(report_path: Path, output_path: Path) -> None:
    report = _load(report_path)
    routers = report["routers"]
    names = [router["name"] for router in routers]
    labels = list(report["routes"])
    colors = [COLORS[name] for name in names]
    x = np.arange(len(names))
    width = 0.34
    figure, axes = plt.subplots(2, 3, figsize=(19, 11), constrained_layout=True)
    figure.suptitle("Agent Execution Router A/B", fontsize=17, fontweight="bold")

    quality = axes[0, 0]
    quality.bar(x - width / 2, [r["metrics"]["accuracy"] for r in routers], width, label="Accuracy")
    quality.bar(x + width / 2, [r["metrics"]["macro_f1"] for r in routers], width, label="Macro-F1")
    quality.set_xticks(x, names)
    quality.set_ylim(0, 1.08)
    quality.legend(frameon=False)
    _style(quality, "Overall routing quality", "Score (0–1)")
    _bar_labels(quality)

    latency = axes[0, 1]
    latency.bar(x - width / 2, [r["metrics"]["p50_ms"] for r in routers], width, label="p50")
    latency.bar(x + width / 2, [r["metrics"]["p95_ms"] for r in routers], width, label="p95")
    latency.set_xticks(x, names)
    latency.set_yscale("log")
    latency.legend(frameon=False)
    _style(latency, "Routing latency — log scale", "Milliseconds")
    _bar_labels(latency, 2)

    costs = axes[0, 2]
    costs.bar(names, [r["metrics"]["total_cost_usd"] for r in routers], color=colors)
    _style(costs, "API cost for benchmark", "USD")
    _bar_labels(costs, 5)

    route_x = np.arange(len(labels))
    per_route = axes[1, 0]
    for index, router in enumerate(routers):
        per_route.bar(
            route_x + (index - 0.5) * width,
            [router["metrics"]["per_route"][label]["f1-score"] for label in labels],
            width,
            label=router["name"],
            color=colors[index],
        )
    per_route.set_xticks(route_x, labels, rotation=20, ha="right")
    per_route.set_ylim(0, 1.08)
    per_route.legend(frameon=False)
    _style(per_route, "F1 by execution route", "F1 score")
    _bar_labels(per_route)

    for axis, router in zip(axes[1, 1:], routers):
        matrix = np.asarray(router["metrics"]["confusion_matrix"])
        image = axis.imshow(matrix, cmap="Blues", vmin=0, vmax=max(int(matrix.max()), 1))
        axis.set_title(f"Confusion — {router['name']}", loc="left", fontweight="bold")
        axis.set_xticks(range(len(labels)), labels, rotation=35, ha="right", fontsize=8)
        axis.set_yticks(range(len(labels)), labels, fontsize=8)
        axis.set_xlabel("Predicted route")
        axis.set_ylabel("Expected route")
        for row in range(len(labels)):
            for column in range(len(labels)):
                axis.text(column, row, str(matrix[row, column]), ha="center", va="center")
        figure.colorbar(image, ax=axis, shrink=0.75)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def plot_judge_dashboard(report_path: Path, output_path: Path) -> None:
    report = _load(report_path)
    names = list(report["router_summaries"])
    summaries = [report["router_summaries"][name] for name in names]
    models = list(report["judge_summaries"])
    judges = [report["judge_summaries"][model] for model in models]
    x = np.arange(len(names))
    width = 0.24
    figure, axes = plt.subplots(1, 2, figsize=(15, 6), constrained_layout=True)
    figure.suptitle("Routing LLM-as-a-Judge", fontsize=17, fontweight="bold")

    quality = axes[0]
    quality.bar(x - width, [s["route_pass_rate"] for s in summaries], width, label="Route pass")
    quality.bar(x, [1 - s["mean_groundless_rate"] for s in summaries], width, label="Groundedness")
    quality.bar(
        x + width, [s["hallucination_rate"] for s in summaries], width, label="Hallucination"
    )
    quality.set_xticks(x, names)
    quality.set_ylim(0, 1.08)
    quality.legend(frameon=False)
    _style(quality, "Paired judge outcomes", "Rate (0–1)")
    _bar_labels(quality)

    cost = axes[1]
    bars = cost.bar(
        models, [judge["cost_usd"] for judge in judges], color=["#7C3AED", "#059669", "#DB2777"]
    )
    cost.bar_label(bars, fmt="$%.4f", padding=3, fontsize=8)
    cost.tick_params(axis="x", rotation=15)
    _style(cost, "Judge cost and latency", "Cost (USD)")
    latency = cost.twinx()
    latency.plot(
        models, [judge["mean_latency_ms"] / 1_000 for judge in judges], color="#111827", marker="o"
    )
    latency.set_ylabel("Mean latency (seconds)")
    latency.spines["top"].set_visible(False)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def create_plots(ab_report: Path, judge_report: Path | None, output_dir: Path) -> list[Path]:
    outputs = [output_dir / "router-ab-dashboard.png"]
    plot_router_dashboard(ab_report, outputs[0])
    if judge_report:
        outputs.append(output_dir / "router-judge-dashboard.png")
        plot_judge_dashboard(judge_report, outputs[1])
    return outputs
