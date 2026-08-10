from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np

plt.switch_backend("Agg")


COLORS = {"A_distilbert": "#2563EB", "B_minilm": "#F97316"}
JUDGE_COLORS = {"gpt-5.6-sol": "#7C3AED", "gpt-5.6-terra": "#059669", "gpt-5.6-luna": "#DB2777"}


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _label_bars(axis: Any, *, digits: int = 2) -> None:
    for container in axis.containers:
        axis.bar_label(container, fmt=f"%.{digits}f", padding=3, fontsize=8)


def _style_axis(axis: Any, title: str, ylabel: str) -> None:
    axis.set_title(title, loc="left", fontweight="bold")
    axis.set_ylabel(ylabel)
    axis.spines[["top", "right"]].set_visible(False)
    axis.grid(axis="y", alpha=0.2)
    axis.set_axisbelow(True)


def _classifier_names(local_report: dict[str, Any]) -> list[str]:
    return [classifier["name"] for classifier in local_report["classifiers"]]


def plot_classifier_report(local_report: dict[str, Any], output_path: Path) -> None:
    names = _classifier_names(local_report)
    runs = local_report["classifiers"]
    colors = [COLORS.get(name, "#64748B") for name in names]
    figure, axes = plt.subplots(2, 2, figsize=(14, 9), constrained_layout=True)
    figure.suptitle("Hugging Face Classifier A/B — GPU Full Run", fontsize=16, fontweight="bold")

    x = np.arange(len(names))
    width = 0.34
    quality = axes[0, 0]
    quality.bar(x - width / 2, [run["metrics"]["accuracy"] for run in runs], width, label="Accuracy")
    quality.bar(x + width / 2, [run["metrics"]["macro_f1"] for run in runs], width, label="Macro-F1")
    quality.set_xticks(x, names)
    quality.set_ylim(0, 1)
    quality.legend(frameon=False)
    _style_axis(quality, "Classification quality", "Score (0–1)")
    _label_bars(quality, digits=3)

    latency = axes[0, 1]
    latency.bar(x - width / 2, [run["metrics"]["p50_ms"] for run in runs], width, label="p50")
    latency.bar(x + width / 2, [run["metrics"]["p95_ms"] for run in runs], width, label="p95")
    latency.set_xticks(x, names)
    latency.legend(frameon=False)
    _style_axis(latency, "Single-sample inference latency", "Milliseconds")
    _label_bars(latency)

    training = axes[1, 0]
    training.bar(names, [run["metrics"]["training_seconds"] for run in runs], color=colors)
    _style_axis(training, "Fine-tuning wall time", "Seconds")
    _label_bars(training)

    memory = axes[1, 1]
    memory.bar(
        x - width / 2,
        [run["metrics"]["parameter_memory_mb"] for run in runs],
        width,
        label="Parameters",
    )
    memory.bar(
        x + width / 2,
        [run["metrics"]["peak_cuda_memory_mb"] for run in runs],
        width,
        label="Peak CUDA",
    )
    memory.set_xticks(x, names)
    memory.legend(frameon=False)
    _style_axis(memory, "Memory footprint", "MiB")
    _label_bars(memory, digits=1)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def plot_judge_report(judge_report: dict[str, Any], output_path: Path) -> None:
    names = list(judge_report["summaries"])
    summaries = [judge_report["summaries"][name] for name in names]
    models = list(judge_report["judge_model_summaries"])
    model_summaries = [judge_report["judge_model_summaries"][model] for model in models]
    figure, axes = plt.subplots(1, 2, figsize=(15, 6), constrained_layout=True)
    figure.suptitle("Three-model LLM-as-a-Judge — Paired A/B", fontsize=16, fontweight="bold")

    x = np.arange(len(names))
    width = 0.24
    quality = axes[0]
    quality.bar(
        x - width,
        [summary["classification_pass_rate"] for summary in summaries],
        width,
        label="Classification pass",
    )
    quality.bar(
        x,
        [1 - summary["mean_groundless_rate"] for summary in summaries],
        width,
        label="Groundedness",
    )
    quality.bar(
        x + width,
        [summary["hallucination_rate"] for summary in summaries],
        width,
        label="Hallucination",
    )
    quality.set_xticks(x, names)
    quality.set_ylim(0, 1.08)
    quality.legend(frameon=False)
    _style_axis(quality, "Aggregated judge outcomes", "Rate (0–1)")
    _label_bars(quality, digits=3)

    cost = axes[1]
    model_colors = [JUDGE_COLORS.get(model, "#64748B") for model in models]
    bars = cost.bar(models, [summary["total_cost_usd"] for summary in model_summaries], color=model_colors)
    _style_axis(cost, "Judge cost and latency", "Cost (USD per 60 calls)")
    cost.bar_label(bars, fmt="$%.4f", padding=3, fontsize=8)
    cost.tick_params(axis="x", rotation=15)
    latency = cost.twinx()
    latency.plot(
        models,
        [summary["mean_latency_ms"] / 1_000 for summary in model_summaries],
        color="#111827",
        marker="o",
        linewidth=2,
        label="Mean latency",
    )
    latency.set_ylabel("Mean latency (seconds)")
    latency.spines["top"].set_visible(False)
    latency.legend(loc="upper right", frameon=False)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=180, bbox_inches="tight")
    plt.close(figure)


def plot_dashboard(local_report_path: Path, judge_report_path: Path, output_dir: Path) -> list[Path]:
    local_report = _load(local_report_path)
    judge_report = _load(judge_report_path)
    outputs = [output_dir / "classifier-ab.png", output_dir / "llm-judge-ab.png"]
    plot_classifier_report(local_report, outputs[0])
    plot_judge_report(judge_report, outputs[1])
    return outputs
