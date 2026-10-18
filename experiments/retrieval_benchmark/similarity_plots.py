from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np


def plot_benchmark_report(report: dict[str, Any], *, output_dir: str | Path | None = None, show: bool = True) -> dict[str, Any]:  # noqa: E501
    """평가 요약과 테스트 점수 분포를 그리고 필요하면 PNG로 저장한다."""
    import matplotlib.pyplot as plt

    methods = report["methods"]
    names = [row["method"] for row in methods]
    short_names = [name.split("_", 1)[0] for name in names]
    positions = np.arange(len(methods))

    summary, axes = plt.subplots(2, 2, figsize=(16, 10), constrained_layout=True)
    summary.suptitle("Retrieval Answerability Benchmark", fontsize=16, fontweight="bold")

    width = 0.24
    for offset, metric, color in (
        (-width, "precision", "#2563EB"),
        (0.0, "recall", "#16A34A"),
        (width, "f1", "#EA580C"),
    ):
        axes[0, 0].bar(
            positions + offset,
            [row[metric] for row in methods],
            width=width,
            label=metric,
            color=color,
            alpha=0.85
        )
    axes[0, 0].set_title("Accept Decision Quality")
    axes[0, 0].set_xticks(positions, short_names)
    axes[0, 0].set_ylim(0.0, 1.05)
    axes[0, 0].set_ylabel("score")
    axes[0, 0].legend(frameon=False)
    axes[0, 0].grid(axis="y", alpha=0.2)

    coverages = [row["coverage"] for row in methods]
    false_accepts = [row["false_accept_rate"] for row in methods]
    scatter = axes[0, 1].scatter(
        coverages,
        false_accepts,
        c=[row["f1"] for row in methods],
        cmap="viridis",
        s=110,
        edgecolor="white",
        linewidth=0.8
    )
    coordinate_labels: dict[tuple[float, float], list[str]] = {}
    for name, coverage, false_accept in zip(short_names, coverages, false_accepts, strict=True):
        coordinate_labels.setdefault((round(coverage, 6), round(false_accept, 6)), []).append(name)
    for (coverage, false_accept), labels_at_coordinate in coordinate_labels.items():
        axes[0, 1].annotate(
            ", ".join(labels_at_coordinate),
            (coverage, false_accept),
            xytext=(5, 5),
            textcoords="offset points"
        )
    axes[0, 1].axhline(
        0.10, color="#DC2626", linestyle="--", linewidth=1.2, label="FAR guardrail 0.10"
    )
    axes[0, 1].set_title("Risk-Coverage Trade-off")
    axes[0, 1].set_xlabel("coverage (higher is better)")
    axes[0, 1].set_ylabel("false accept rate (lower is better)")
    axes[0, 1].set_xlim(-0.03, 1.03)
    axes[0, 1].set_ylim(-0.03, 1.03)
    axes[0, 1].legend(frameon=False)
    axes[0, 1].grid(alpha=0.2)
    summary.colorbar(scatter, ax=axes[0, 1], label="F1")

    axes[1, 0].bar(
        positions - width / 2,
        [row["false_accept_rate"] for row in methods],
        width=width,
        label="false accept",
        color="#DC2626",
        alpha=0.8
    )
    axes[1, 0].bar(
        positions + width / 2,
        [row["false_reject_rate"] for row in methods],
        width=width,
        label="false reject",
        color="#7C3AED",
        alpha=0.8
    )
    axes[1, 0].plot(
        positions,
        [row["brier"] for row in methods],
        color="#111827",
        marker="o",
        linewidth=1.5,
        label="Brier"
    )
    axes[1, 0].set_title("Error Rates and Calibration")
    axes[1, 0].set_xticks(positions, short_names)
    axes[1, 0].set_ylim(0.0, 1.05)
    axes[1, 0].legend(frameon=False, ncol=3)
    axes[1, 0].grid(axis="y", alpha=0.2)

    candidates = report["cluster"]["candidates"]
    if candidates:
        candidate_k = [row["k"] for row in candidates]
        silhouettes = [row["silhouette"] for row in candidates]
        axes[1, 1].plot(candidate_k, silhouettes, marker="o", color="#0891B2", linewidth=2)
        axes[1, 1].axvline(
            report["cluster"]["chosen_k"],
            color="#EA580C",
            linestyle="--",
            label=f"chosen K={report['cluster']['chosen_k']}"
        )
        axes[1, 1].legend(frameon=False)
        axes[1, 1].set_xticks(candidate_k)
    else:
        axes[1, 1].text(0.5, 0.5, "K=1 fallback\n(no valid candidates)", ha="center", va="center")
    axes[1, 1].set_title("Cluster Selection")
    axes[1, 1].set_xlabel("K")
    axes[1, 1].set_ylabel("cosine silhouette")
    axes[1, 1].grid(alpha=0.2)

    details = report["method_details"]
    labels = np.asarray(report["test_labels"], dtype=bool)
    score_figure, score_axis = plt.subplots(figsize=(16, 6), constrained_layout=True)
    score_figure.suptitle(
        "Test Score Separation and Validation Thresholds", fontsize=15, fontweight="bold"
    )
    box_width = 0.28
    legend_handles = None
    for index, name in enumerate(names):
        scores = np.asarray(details[name]["scores"], dtype=float)
        negative_scores = scores[~labels]
        positive_scores = scores[labels]
        boxes = score_axis.boxplot(
            [negative_scores, positive_scores],
            positions=[index - 0.18, index + 0.18],
            widths=box_width,
            patch_artist=True,
            manage_ticks=False,
            medianprops={"color": "#111827"}
        )
        boxes["boxes"][0].set_facecolor("#FCA5A5")
        boxes["boxes"][1].set_facecolor("#86EFAC")
        score_axis.scatter(
            index, details[name]["threshold"], marker="D", s=55, color="#1D4ED8", zorder=4
        )
        if legend_handles is None:
            legend_handles = [boxes["boxes"][0], boxes["boxes"][1]]
    score_axis.set_xticks(positions, short_names)
    score_axis.set_ylim(-0.03, 1.03)
    score_axis.set_ylabel("acceptance probability / score")
    score_axis.grid(axis="y", alpha=0.2)
    threshold_handle = score_axis.scatter([], [], marker="D", s=55, color="#1D4ED8")
    score_axis.legend(
        [*legend_handles, threshold_handle],
        ["unanswerable", "answerable", "threshold"],
        frameon=False,
        ncol=3,
        loc="upper center",
        bbox_to_anchor=(0.5, -0.10)
    )

    saved_paths: dict[str, str] = {}
    if output_dir is not None:
        destination = Path(output_dir)
        destination.mkdir(parents=True, exist_ok=True)
        summary_path = destination / "benchmark_summary.png"
        scores_path = destination / "score_distributions.png"
        summary.savefig(summary_path, dpi=160, bbox_inches="tight")
        score_figure.savefig(scores_path, dpi=160, bbox_inches="tight")
        saved_paths = {"summary": str(summary_path.resolve()), "scores": str(scores_path.resolve())}
    if show and "agg" not in plt.get_backend().lower():
        plt.show()
    return {"summary": summary, "scores": score_figure, "saved_paths": saved_paths}
