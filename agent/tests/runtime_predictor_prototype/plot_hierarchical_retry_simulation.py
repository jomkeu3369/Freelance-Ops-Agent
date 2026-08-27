from __future__ import annotations

from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .hierarchical_retry_simulation import FAILURE_MODE_LABELS, RECOVERY_LABELS, FailureMode, HierarchicalRetryBenchmark, HierarchicalRetryConfig, HierarchicalRetrySummary, RecoveryPolicy, build_hierarchical_retry_benchmark, summarize_hierarchical_retry


POLICY_COLORS = ("tab:gray", "tab:blue", "tab:orange", "tab:green", "tab:purple")


def _bar_panel(axis: plt.Axes, benchmark: HierarchicalRetryBenchmark, title: str, ylabel: str, metric_name: str, *, multiplier: float = 1.0, threshold: float | None = None) -> None:
    positions = np.arange(len(benchmark.summaries))
    metrics = [getattr(summary, metric_name) for summary in benchmark.summaries]
    values = [float(metric.mean if hasattr(metric, "mean") else metric) * multiplier for metric in metrics]
    errors = [float(metric.ci95 if hasattr(metric, "ci95") else 0.0) * multiplier for metric in metrics]
    axis.bar(positions, values, yerr=errors, capsize=4, color=POLICY_COLORS)
    if threshold is not None:
        axis.axhline(threshold, color="black", linestyle="--", linewidth=1.1, label="Production gate")
        axis.legend(loc="lower left")
    axis.set_xticks(positions, [RECOVERY_LABELS[summary.policy] for summary in benchmark.summaries], rotation=22, ha="right")
    axis.set_title(title)
    axis.set_ylabel(ylabel)
    axis.grid(axis="y", alpha=0.25)


def build_hierarchical_retry_comparison_plot(output_path: Path | None = None, *, benchmark: HierarchicalRetryBenchmark | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59)) -> tuple[Path, HierarchicalRetryBenchmark]:
    selected = benchmark or build_hierarchical_retry_benchmark(seeds=seeds)
    figure, axes = plt.subplots(2, 3, figsize=(20, 11), constrained_layout=True)
    _bar_panel(axes[0, 0], selected, "Completion SLO goodput", "Goodput (%) · higher is better", "completion_slo_goodput", multiplier=100, threshold=95.0)
    _bar_panel(axes[0, 1], selected, "Priority wait SLO goodput", "Priority goodput (%) · higher is better", "high_priority_wait_slo_goodput", multiplier=100, threshold=95.0)
    _bar_panel(axes[0, 2], selected, "Worst-workspace goodput", "Worst workspace (%) · higher is better", "worst_workspace_completion_goodput", multiplier=100, threshold=90.0)
    _bar_panel(axes[1, 0], selected, "Retry demand amplification", "Executed / original service demand · lower is better", "demand_amplification")
    _bar_panel(axes[1, 1], selected, "Expected worker cost", "USD per run · lower is better", "estimated_worker_cost")
    _bar_panel(axes[1, 2], selected, "Counterfactual hard-gate pass", "Pass probability (%) · higher is better", "expected_hard_gate_pass_rate", multiplier=100, threshold=90.0)
    decision = "No policy passes every failure-mode gate" if selected.selected_policy is None else f"Selected: {RECOVERY_LABELS[selected.selected_policy]}"
    figure.suptitle(f"Hierarchical Scheduler + retry recovery · scale success 90% · {len(seeds)} paired seeds\n{decision}", fontsize=15)
    destination = output_path or Path(__file__).with_name("scheduler_hierarchical_retry_comparison.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, selected


def _mode_summary(benchmark: HierarchicalRetryBenchmark, policy: RecoveryPolicy, failure_mode: FailureMode) -> HierarchicalRetrySummary:
    success = [row for row in benchmark.success_rows if row.failure_mode is failure_mode]
    failure = [row for row in benchmark.failure_rows if row.failure_mode is failure_mode]
    return summarize_hierarchical_retry(success, failure, policy, benchmark.retry_config.scale_success_probability)


def _heatmap(axis: plt.Axes, values: np.ndarray, title: str, *, minimum: float, maximum: float, suffix: str) -> None:
    image = axis.imshow(values, cmap="RdYlGn", vmin=minimum, vmax=maximum, aspect="auto")
    axis.set_xticks(np.arange(len(FailureMode)), [FAILURE_MODE_LABELS[mode] for mode in FailureMode], rotation=16, ha="right")
    axis.set_yticks(np.arange(len(RecoveryPolicy)), [RECOVERY_LABELS[policy] for policy in RecoveryPolicy])
    axis.set_title(title)
    for row_index in range(values.shape[0]):
        for column_index in range(values.shape[1]):
            axis.text(column_index, row_index, f"{values[row_index, column_index]:.1f}{suffix}", ha="center", va="center", color="black")
    plt.colorbar(image, ax=axis, shrink=0.82)


def build_hierarchical_retry_mode_table_plot(output_path: Path | None = None, *, benchmark: HierarchicalRetryBenchmark | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59)) -> tuple[Path, HierarchicalRetryBenchmark]:
    selected = benchmark or build_hierarchical_retry_benchmark(seeds=seeds)
    completion = np.array([[100 * _mode_summary(selected, policy, failure_mode).completion_slo_goodput.mean for failure_mode in FailureMode] for policy in RecoveryPolicy])
    worst_workspace = np.array([[100 * _mode_summary(selected, policy, failure_mode).worst_workspace_completion_goodput.mean for failure_mode in FailureMode] for policy in RecoveryPolicy])
    gate = np.array([[100 * dict(next(summary for summary in selected.summaries if summary.policy is policy).hard_gate_pass_by_mode)[failure_mode] for failure_mode in FailureMode] for policy in RecoveryPolicy])
    figure, axes = plt.subplots(1, 3, figsize=(20, 7.5), constrained_layout=True)
    _heatmap(axes[0], completion, "Completion goodput", minimum=90.0, maximum=100.0, suffix="%")
    _heatmap(axes[1], worst_workspace, "Worst-workspace goodput", minimum=80.0, maximum=100.0, suffix="%")
    _heatmap(axes[2], gate, "Hard-gate pass by failure mode", minimum=50.0, maximum=100.0, suffix="%")
    figure.suptitle("Failure-mode result table · rejected and late tasks remain submitted failures\nOnly failure-aware checkpoint + provider failover clears both mode-specific gates", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_hierarchical_retry_mode_table.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, selected


def build_hierarchical_retry_sensitivity_plot(output_path: Path | None = None, *, seeds: tuple[int, ...] = (11, 23, 37, 42, 59), failover_delays: tuple[float, ...] = (0.0, 10.0, 20.0, 30.0, 45.0, 60.0), failure_probabilities: tuple[float, ...] = (0.05, 0.10, 0.20, 0.30, 0.40), retry_budgets: tuple[float, ...] = (0.05, 0.10, 0.20, 0.35, 0.50)) -> tuple[Path, dict[str, tuple[HierarchicalRetrySummary, ...]]]:
    policy = RecoveryPolicy.FAILURE_AWARE
    failover = tuple(build_hierarchical_retry_benchmark(retry_config=HierarchicalRetryConfig(provider_failover_seconds=value), seeds=seeds, failure_modes=[FailureMode.PROVIDER_OUTAGE], policies=[policy]).summaries[0] for value in failover_delays)
    failures = tuple(build_hierarchical_retry_benchmark(retry_config=HierarchicalRetryConfig(independent_failure_probability=value), seeds=seeds, failure_modes=[FailureMode.INDEPENDENT], policies=[policy]).summaries[0] for value in failure_probabilities)
    budgets = tuple(build_hierarchical_retry_benchmark(retry_config=HierarchicalRetryConfig(retry_budget_ratio=value), seeds=seeds, policies=[policy]).summaries[0] for value in retry_budgets)
    figure, axes = plt.subplots(1, 3, figsize=(20, 6.5), constrained_layout=True)
    for metric_name, label, marker in (("completion_slo_goodput", "Completion", "o"), ("high_priority_wait_slo_goodput", "Priority", "s"), ("worst_workspace_completion_goodput", "Worst workspace", "^"), ("expected_hard_gate_pass_rate", "Hard-gate pass", "D")):
        axes[0].plot(failover_delays, [100 * float(getattr(summary, metric_name).mean if hasattr(getattr(summary, metric_name), "mean") else getattr(summary, metric_name)) for summary in failover], marker=marker, linewidth=2, label=label)
        axes[1].plot(failure_probabilities, [100 * float(getattr(summary, metric_name).mean if hasattr(getattr(summary, metric_name), "mean") else getattr(summary, metric_name)) for summary in failures], marker=marker, linewidth=2, label=label)
    axes[0].set_title("Provider failover delay boundary")
    axes[0].set_xlabel("Failover delay (seconds)")
    axes[1].set_title("Independent failure-rate boundary")
    axes[1].set_xlabel("Attempt failure probability")
    axes[0].set_ylabel("Rate (%) · higher is better")
    axes[0].legend(loc="lower left", fontsize=8)
    axes[2].plot(retry_budgets, [100 * summary.completion_slo_goodput.mean for summary in budgets], marker="o", linewidth=2, label="Completion")
    axes[2].plot(retry_budgets, [100 * summary.worst_workspace_completion_goodput.mean for summary in budgets], marker="^", linewidth=2, label="Worst workspace")
    axes[2].plot(retry_budgets, [100 * summary.expected_hard_gate_pass_rate for summary in budgets], marker="D", linewidth=2, label="Hard-gate pass")
    axes[2].plot(retry_budgets, [100 * summary.retry_budget_exhaustion_rate.mean for summary in budgets], marker="x", linewidth=2, label="Budget exhaustion")
    axes[2].set_title("Global retry-budget boundary")
    axes[2].set_xlabel("Retry budget / submitted tasks")
    for axis in axes:
        axis.axhline(90.0, color="black", linestyle="--", linewidth=1.0)
        axis.grid(alpha=0.25)
    axes[2].legend(loc="center right", fontsize=8)
    figure.suptitle("Failure-aware recovery sensitivity · 3 adversarial scenarios\n20s failover and 20% retry budget are the conservative operating point", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_hierarchical_retry_sensitivity.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, {"failover": failover, "failure": failures, "budget": budgets}


def main() -> None:
    comparison_path, benchmark = build_hierarchical_retry_comparison_plot()
    table_path, _ = build_hierarchical_retry_mode_table_plot(benchmark=benchmark)
    sensitivity_path, _ = build_hierarchical_retry_sensitivity_plot()
    for summary in benchmark.summaries:
        modes = ", ".join(f"{FAILURE_MODE_LABELS[mode]}={100 * rate:.1f}%" for mode, rate in summary.hard_gate_pass_by_mode)
        print(f"{RECOVERY_LABELS[summary.policy]}: completion={100 * summary.completion_slo_goodput.mean:.1f}%, priority={100 * summary.high_priority_wait_slo_goodput.mean:.1f}%, worst={100 * summary.worst_workspace_completion_goodput.mean:.1f}%, amplification={summary.demand_amplification.mean:.3f}, cost=${summary.estimated_worker_cost.mean:.3f}, gate={100 * summary.expected_hard_gate_pass_rate:.1f}%, {modes}")
    print(f"Selected policy: {RECOVERY_LABELS[benchmark.selected_policy] if benchmark.selected_policy is not None else 'none'}")
    print(comparison_path)
    print(table_path)
    print(sensitivity_path)


if __name__ == "__main__":
    main()
