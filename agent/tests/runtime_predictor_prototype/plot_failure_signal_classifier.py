from __future__ import annotations

from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .failure_signal_classifier import SIGNAL_CLASSIFIER_LABELS, IncidentKind, SignalClassifierBenchmark, SignalClassifierConfig, SignalClassifierKind, SignalClassifierSummary, run_signal_classifier_benchmark


CLASSIFIER_COLORS = ("tab:gray", "tab:orange", "tab:green", "tab:blue")
INCIDENT_LABELS = {IncidentKind.INDEPENDENT_WORKER: "Independent worker", IncidentKind.INDEPENDENT_TOOL: "Independent tool", IncidentKind.PROVIDER_OUTAGE: "Provider outage", IncidentKind.PROVIDER_RATE_LIMIT: "Provider rate limit"}


def _bar_panel(axis: plt.Axes, benchmark: SignalClassifierBenchmark, title: str, ylabel: str, metric_name: str, *, multiplier: float = 1.0, threshold: float | None = None, lower_is_better: bool = False) -> None:
    positions = np.arange(len(benchmark.summaries))
    metrics = [getattr(summary, metric_name) for summary in benchmark.summaries]
    values = [float(metric.mean if hasattr(metric, "mean") else metric) * multiplier for metric in metrics]
    errors = [float(metric.ci95 if hasattr(metric, "ci95") else 0.0) * multiplier for metric in metrics]
    axis.bar(positions, values, yerr=errors, capsize=4, color=CLASSIFIER_COLORS)
    if threshold is not None:
        axis.axhline(threshold, color="black", linestyle="--", linewidth=1.1, label="Operational gate")
        axis.legend(loc="upper left" if lower_is_better else "lower left")
    axis.set_xticks(positions, [SIGNAL_CLASSIFIER_LABELS[summary.classifier] for summary in benchmark.summaries], rotation=20, ha="right")
    axis.set_title(title)
    axis.set_ylabel(ylabel)
    axis.grid(axis="y", alpha=0.25)


def build_failure_signal_classifier_comparison_plot(output_path: Path | None = None, *, benchmark: SignalClassifierBenchmark | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59), incident_count: int = 2_000) -> tuple[Path, SignalClassifierBenchmark]:
    selected = benchmark or run_signal_classifier_benchmark(seeds=seeds, incident_count=incident_count)
    figure, axes = plt.subplots(2, 3, figsize=(20, 11), constrained_layout=True)
    _bar_panel(axes[0, 0], selected, "False circuit-open actions", "Independent incidents (%) · lower is better", "action_false_positive_rate", multiplier=100, threshold=10.0, lower_is_better=True)
    _bar_panel(axes[0, 1], selected, "Missed correlated failures by 10s", "Correlated incidents (%) · lower is better", "detection_false_negative_rate", multiplier=100, threshold=15.0, lower_is_better=True)
    _bar_panel(axes[0, 2], selected, "P95 correlated detection delay", "Seconds · lower is better", "p95_detection_seconds", threshold=20.0, lower_is_better=True)
    _bar_panel(axes[1, 0], selected, "Correlated action precision", "Precision (%) · higher is better", "correlated_precision", multiplier=100, threshold=90.0)
    _bar_panel(axes[1, 1], selected, "Low-confidence observations", "Observations below 70% confidence (%)", "low_confidence_rate", multiplier=100)
    _bar_panel(axes[1, 2], selected, "Operational gate pass", "Paired seeds passed (%) · higher is better", "operational_gate_pass_rate", multiplier=100, threshold=100.0)
    decision = "No classifier passes every gate" if selected.selected_classifier is None else f"Selected: {SIGNAL_CLASSIFIER_LABELS[selected.selected_classifier]}"
    incident_label = format(incident_count, "_")
    figure.suptitle(f"Multi-signal failure classifier · temporal drift holdout · {len(seeds)} seeds × {incident_label} incidents\n{decision}", fontsize=15)
    destination = output_path or Path(__file__).with_name("scheduler_failure_signal_classifier_comparison.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, selected


def _heatmap(axis: plt.Axes, values: np.ndarray, row_labels: list[str], column_labels: list[str], title: str, *, minimum: float, maximum: float) -> None:
    image = axis.imshow(values, cmap="RdYlGn", vmin=minimum, vmax=maximum, aspect="auto")
    axis.set_xticks(np.arange(len(column_labels)), column_labels, rotation=18, ha="right")
    axis.set_yticks(np.arange(len(row_labels)), row_labels)
    axis.set_title(title)
    for row_index in range(values.shape[0]):
        for column_index in range(values.shape[1]):
            axis.text(column_index, row_index, f"{values[row_index, column_index]:.1f}%", ha="center", va="center", color="black")
    plt.colorbar(image, ax=axis, shrink=0.82)


def build_failure_signal_classifier_table_plot(output_path: Path | None = None, *, benchmark: SignalClassifierBenchmark | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59), incident_count: int = 2_000) -> tuple[Path, SignalClassifierBenchmark]:
    selected = benchmark or run_signal_classifier_benchmark(seeds=seeds, incident_count=incident_count)
    classifiers = tuple(SignalClassifierKind)
    recall = np.array([[100 * dict(summary.recall_by_kind)[kind].mean for kind in IncidentKind] for summary in selected.summaries])
    operational = np.array([[100 * (1 - summary.action_false_positive_rate.mean), 100 * (1 - summary.detection_false_negative_rate.mean), 100 * summary.correlated_precision.mean, 100 * summary.operational_gate_pass_rate] for summary in selected.summaries])
    row_labels = [SIGNAL_CLASSIFIER_LABELS[classifier] for classifier in classifiers]
    figure, axes = plt.subplots(1, 2, figsize=(20, 7.2), constrained_layout=True)
    _heatmap(axes[0], recall, row_labels, [INCIDENT_LABELS[kind] for kind in IncidentKind], "Per-incident correct action table", minimum=0.0, maximum=100.0)
    _heatmap(axes[1], operational, row_labels, ["Independent safety", "Detection recall ≤10s", "Action precision", "Seed gate pass"], "Operational metric table", minimum=0.0, maximum=100.0)
    figure.suptitle("Failure classifier result table · final incident labels are unavailable at decision time\nTemporal holdout contains status-page blind spots and correlated local/tool symptoms", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_failure_signal_classifier_table.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, selected


def build_failure_signal_threshold_plot(output_path: Path | None = None, *, seeds: tuple[int, ...] = (11, 23, 37, 42, 59), incident_count: int = 2_000, thresholds: tuple[float, ...] = (2.0, 3.0, 4.0, 5.0, 6.0, 7.0)) -> tuple[Path, tuple[SignalClassifierSummary, ...]]:
    summaries = tuple(run_signal_classifier_benchmark(config=SignalClassifierConfig(weighted_rule_threshold=value), seeds=seeds, incident_count=incident_count, classifiers=[SignalClassifierKind.WEIGHTED_RULE]).summaries[0] for value in thresholds)
    figure, axes = plt.subplots(1, 3, figsize=(20, 6.5), constrained_layout=True)
    axes[0].plot(thresholds, [100 * summary.action_false_positive_rate.mean for summary in summaries], marker="o", linewidth=2, label="Action FPR")
    axes[0].plot(thresholds, [100 * summary.detection_false_negative_rate.mean for summary in summaries], marker="s", linewidth=2, label="Detection FNR")
    axes[0].axhline(10.0, color="black", linestyle="--", linewidth=1.1, label="FPR gate")
    axes[0].axhline(15.0, color="black", linestyle=":", linewidth=1.1, label="FNR gate")
    axes[0].set_title("Error tradeoff")
    axes[0].set_ylabel("Incident rate (%) · lower is better")
    axes[0].legend(loc="upper left", fontsize=8)
    axes[1].plot(thresholds, [summary.p95_detection_seconds.mean for summary in summaries], marker="o", linewidth=2, color="tab:orange")
    axes[1].axhline(20.0, color="black", linestyle="--", linewidth=1.1)
    axes[1].set_title("P95 detection delay")
    axes[1].set_ylabel("Seconds · lower is better")
    axes[2].plot(thresholds, [100 * summary.correlated_precision.mean for summary in summaries], marker="o", linewidth=2, label="Action precision")
    axes[2].plot(thresholds, [100 * summary.operational_gate_pass_rate for summary in summaries], marker="s", linewidth=2, label="Seed gate pass")
    axes[2].axhline(90.0, color="black", linestyle="--", linewidth=1.1)
    axes[2].set_title("Operational eligibility")
    axes[2].set_ylabel("Rate (%) · higher is better")
    axes[2].legend(loc="lower right", fontsize=8)
    for axis in axes:
        axis.set_xlabel("Weighted-rule threshold")
        axis.grid(alpha=0.25)
    figure.suptitle("Weighted multi-signal rule threshold sensitivity\nThreshold 4 is the only tested point clearing every operational gate", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_failure_signal_threshold_sensitivity.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, summaries


def main() -> None:
    comparison_path, benchmark = build_failure_signal_classifier_comparison_plot()
    table_path, _ = build_failure_signal_classifier_table_plot(benchmark=benchmark)
    threshold_path, _ = build_failure_signal_threshold_plot()
    for summary in benchmark.summaries:
        print(f"{SIGNAL_CLASSIFIER_LABELS[summary.classifier]}: action FPR={100 * summary.action_false_positive_rate.mean:.1f}%, detection FNR={100 * summary.detection_false_negative_rate.mean:.1f}%, P95 detection={summary.p95_detection_seconds.mean:.1f}s, precision={100 * summary.correlated_precision.mean:.1f}%, gate={100 * summary.operational_gate_pass_rate:.1f}%")
    print(f"Selected classifier: {SIGNAL_CLASSIFIER_LABELS[benchmark.selected_classifier] if benchmark.selected_classifier is not None else 'none'}")
    print(comparison_path)
    print(table_path)
    print(threshold_path)


if __name__ == "__main__":
    main()
