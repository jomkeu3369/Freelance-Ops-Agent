from __future__ import annotations

from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .hierarchical_reliability_simulation import RELIABILITY_LABELS, ExpectedReliabilitySummary, HierarchicalReliabilityBenchmark, HierarchicalReliabilityConfig, HierarchicalReliabilityStrategy, build_expected_reliability_benchmark, generate_reliability_state_rows, summarize_expected_reliability


STRATEGY_COLORS = ("tab:gray", "tab:blue", "tab:orange", "tab:green", "tab:purple")


def _bar_panel(axis: plt.Axes, benchmark: HierarchicalReliabilityBenchmark, title: str, ylabel: str, metric_name: str, *, multiplier: float = 1.0, threshold: float | None = None) -> None:
    positions = np.arange(len(benchmark.summaries))
    metrics = [getattr(summary, metric_name) for summary in benchmark.summaries]
    values = [float(metric.mean if hasattr(metric, "mean") else metric) * multiplier for metric in metrics]
    errors = [float(metric.ci95 if hasattr(metric, "ci95") else 0.0) * multiplier for metric in metrics]
    axis.bar(positions, values, yerr=errors, capsize=4, color=STRATEGY_COLORS)
    if threshold is not None:
        axis.axhline(threshold, color="black", linestyle="--", linewidth=1.1, label="Production gate")
        axis.legend(loc="lower left" if "higher" in ylabel else "upper left")
    axis.set_xticks(positions, [RELIABILITY_LABELS[summary.strategy] for summary in benchmark.summaries], rotation=22, ha="right")
    axis.set_title(title)
    axis.set_ylabel(ylabel)
    axis.grid(axis="y", alpha=0.25)


def build_hierarchical_reliability_comparison_plot(output_path: Path | None = None, *, benchmark: HierarchicalReliabilityBenchmark | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59)) -> tuple[Path, HierarchicalReliabilityBenchmark]:
    selected = benchmark or build_expected_reliability_benchmark(seeds=seeds)
    figure, axes = plt.subplots(2, 3, figsize=(20, 11), constrained_layout=True)
    _bar_panel(axes[0, 0], selected, "Completion SLO goodput", "Goodput (%) · higher is better", "completion_slo_goodput", multiplier=100, threshold=95.0)
    _bar_panel(axes[0, 1], selected, "Priority wait SLO goodput", "Priority goodput (%) · higher is better", "high_priority_wait_slo_goodput", multiplier=100, threshold=95.0)
    _bar_panel(axes[0, 2], selected, "Worst-workspace goodput", "Worst workspace (%) · higher is better", "worst_workspace_completion_goodput", multiplier=100, threshold=90.0)
    _bar_panel(axes[1, 0], selected, "Expected hard-gate pass rate", "Pass probability (%) · higher is better", "expected_hard_gate_pass_rate", multiplier=100, threshold=90.0)
    _bar_panel(axes[1, 1], selected, "Expected worker cost", "USD per run · lower is better", "estimated_worker_cost")
    _bar_panel(axes[1, 2], selected, "Cost efficiency", "SLO tasks / worker-dollar · higher is better", "slo_tasks_per_worker_dollar")
    decision = "No strategy passes every gate" if selected.selected_strategy is None else f"Selected: {RELIABILITY_LABELS[selected.selected_strategy]}"
    figure.suptitle(f"Hierarchical Scheduler reliability · scale success {100 * selected.reliability_config.scale_success_probability:.0f}% · {len(seeds)} paired seeds\n{decision}", fontsize=15)
    destination = output_path or Path(__file__).with_name("scheduler_hierarchical_reliability_comparison.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, selected


def build_hierarchical_scale_success_sensitivity_plot(output_path: Path | None = None, *, seeds: tuple[int, ...] = (11, 23, 37, 42, 59), probabilities: tuple[float, ...] = (0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0)) -> tuple[Path, dict[HierarchicalReliabilityStrategy, tuple[ExpectedReliabilitySummary, ...]]]:
    success_rows, failure_rows = generate_reliability_state_rows(seeds=seeds)
    summaries = {strategy: tuple(summarize_expected_reliability(success_rows, failure_rows, strategy, probability) for probability in probabilities) for strategy in HierarchicalReliabilityStrategy}
    figure, axes = plt.subplots(1, 3, figsize=(20, 6.5), constrained_layout=True)
    for index, strategy in enumerate(HierarchicalReliabilityStrategy):
        values = summaries[strategy]
        axes[0].plot(probabilities, [100 * summary.completion_slo_goodput.mean for summary in values], marker="o", linewidth=2, color=STRATEGY_COLORS[index], label=RELIABILITY_LABELS[strategy])
        axes[1].plot(probabilities, [100 * summary.worst_workspace_completion_goodput.mean for summary in values], marker="o", linewidth=2, color=STRATEGY_COLORS[index], label=RELIABILITY_LABELS[strategy])
        axes[2].plot(probabilities, [100 * summary.expected_hard_gate_pass_rate for summary in values], marker="o", linewidth=2, color=STRATEGY_COLORS[index], label=RELIABILITY_LABELS[strategy])
    axes[0].axhline(95.0, color="black", linestyle="--", linewidth=1.1)
    axes[1].axhline(90.0, color="black", linestyle="--", linewidth=1.1)
    axes[2].axhline(90.0, color="black", linestyle="--", linewidth=1.1)
    axes[0].set_title("Completion SLO sensitivity")
    axes[1].set_title("Worst-workspace sensitivity")
    axes[2].set_title("Hard-gate pass probability")
    axes[0].set_ylabel("Rate (%) · higher is better")
    for axis in axes:
        axis.set_xlabel("Scale-up success probability")
        axis.set_ylim(60.0, 102.0)
        axis.grid(alpha=0.25)
    axes[2].legend(loc="lower right", fontsize=8)
    figure.suptitle("Scale failure boundary · fallback activates after the 60s hard deadline\nAdaptive scale strategies require about 70% success probability to clear the aggregate production gate", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_hierarchical_scale_success_boundary.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, summaries


def build_hierarchical_prediction_drift_plot(output_path: Path | None = None, *, seeds: tuple[int, ...] = (11, 23, 37, 42, 59), multipliers: tuple[float, ...] = (0.5, 0.65, 0.8, 0.9, 1.0, 1.1, 1.25), strategy: HierarchicalReliabilityStrategy = HierarchicalReliabilityStrategy.SCALE_THEN_WORKSPACE_QUOTA) -> tuple[Path, tuple[ExpectedReliabilitySummary, ...]]:
    summaries: list[ExpectedReliabilitySummary] = []
    for multiplier in multipliers:
        reliability = HierarchicalReliabilityConfig(prediction_multiplier=multiplier)
        success_rows, failure_rows = generate_reliability_state_rows(reliability_config=reliability, seeds=seeds, strategies=[strategy])
        summaries.append(summarize_expected_reliability(success_rows, failure_rows, strategy, reliability.scale_success_probability))
    figure, axes = plt.subplots(1, 3, figsize=(20, 6.5), constrained_layout=True)
    axes[0].plot(multipliers, [100 * summary.completion_slo_goodput.mean for summary in summaries], marker="o", linewidth=2, label="Completion SLO")
    axes[0].plot(multipliers, [100 * summary.worst_workspace_completion_goodput.mean for summary in summaries], marker="s", linewidth=2, label="Worst workspace")
    axes[0].axhline(95.0, color="black", linestyle="--", linewidth=1.1)
    axes[0].axhline(90.0, color="black", linestyle=":", linewidth=1.1)
    axes[0].set_title("SLO goodput under prediction drift")
    axes[0].set_ylabel("Goodput (%) · higher is better")
    axes[0].legend(loc="lower right")
    axes[1].plot(multipliers, [summary.p95_end_to_end_seconds.mean for summary in summaries], marker="o", linewidth=2, color="tab:orange")
    axes[1].set_title("P95 end-to-end latency")
    axes[1].set_ylabel("Seconds · lower is better")
    axes[2].plot(multipliers, [100 * summary.expected_hard_gate_pass_rate for summary in summaries], marker="o", linewidth=2, color="tab:green")
    axes[2].axhline(90.0, color="black", linestyle="--", linewidth=1.1)
    axes[2].set_title("Hard-gate pass probability")
    axes[2].set_ylabel("Pass probability (%) · higher is better")
    for axis in axes:
        axis.axvline(1.0, color="black", linestyle=":", linewidth=1.0)
        axis.set_xlabel("Predicted / actual runtime multiplier")
        axis.grid(alpha=0.25)
    figure.suptitle(f"Runtime prediction drift · {RELIABILITY_LABELS[strategy]} · scale success 90%\nValues below 1.0 represent systematic underestimation", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_hierarchical_prediction_drift.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, tuple(summaries)


def main() -> None:
    comparison_path, benchmark = build_hierarchical_reliability_comparison_plot()
    success_path, _ = build_hierarchical_scale_success_sensitivity_plot()
    drift_path, _ = build_hierarchical_prediction_drift_plot()
    for summary in benchmark.summaries:
        print(f"{RELIABILITY_LABELS[summary.strategy]}: goodput={100 * summary.completion_slo_goodput.mean:.1f}%, priority={100 * summary.high_priority_wait_slo_goodput.mean:.1f}%, worst={100 * summary.worst_workspace_completion_goodput.mean:.1f}%, gate={100 * summary.expected_hard_gate_pass_rate:.1f}%, cost=${summary.estimated_worker_cost.mean:.3f}, efficiency={summary.slo_tasks_per_worker_dollar.mean:.1f}")
    print(f"Selected strategy: {RELIABILITY_LABELS[benchmark.selected_strategy] if benchmark.selected_strategy is not None else 'none'}")
    print(comparison_path)
    print(success_path)
    print(drift_path)


if __name__ == "__main__":
    main()
