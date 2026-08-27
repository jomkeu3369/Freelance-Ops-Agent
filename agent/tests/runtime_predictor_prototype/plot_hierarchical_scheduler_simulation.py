from __future__ import annotations

from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .hierarchical_scheduler_simulation import HIERARCHICAL_LABELS, HierarchicalBenchmark, HierarchicalConfig, HierarchicalStrategy, run_hierarchical_benchmark
from .tenant_fairness_simulation import TENANT_SCENARIO_LABELS, TenantFairnessScenario


STRATEGY_COLORS = ("tab:gray", "tab:orange", "tab:green", "tab:blue", "tab:purple")


def _bar_panel(axis: plt.Axes, benchmark: HierarchicalBenchmark, title: str, ylabel: str, metric_name: str, *, multiplier: float = 1.0, threshold: float | None = None) -> None:
    positions = np.arange(len(benchmark.summaries))
    values = [getattr(summary, metric_name).mean * multiplier for summary in benchmark.summaries]
    errors = [getattr(summary, metric_name).ci95 * multiplier for summary in benchmark.summaries]
    axis.bar(positions, values, yerr=errors, capsize=4, color=STRATEGY_COLORS)
    if threshold is not None:
        axis.axhline(threshold, color="black", linestyle="--", linewidth=1.2, label="Gate")
        axis.legend(loc="lower left" if "higher" in ylabel else "upper left")
    axis.set_xticks(positions, [HIERARCHICAL_LABELS[summary.strategy] for summary in benchmark.summaries], rotation=20, ha="right")
    axis.set_title(title)
    axis.set_ylabel(ylabel)
    axis.grid(axis="y", alpha=0.25)


def build_hierarchical_comparison_plot(output_path: Path | None = None, *, benchmark: HierarchicalBenchmark | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59)) -> tuple[Path, HierarchicalBenchmark]:
    selected = benchmark or run_hierarchical_benchmark(seeds=seeds)
    figure, axes = plt.subplots(2, 3, figsize=(19, 11), constrained_layout=True)
    _bar_panel(axes[0, 0], selected, "Submitted tasks within 300s SLO", "Goodput (%) · higher is better", "completion_slo_goodput", multiplier=100, threshold=95.0)
    _bar_panel(axes[0, 1], selected, "Priority 4-5 within 60s wait", "Priority SLO goodput (%) · higher is better", "high_priority_wait_slo_goodput", multiplier=100, threshold=95.0)
    _bar_panel(axes[0, 2], selected, "Worst-workspace completion goodput", "Worst workspace (%) · higher is better", "worst_workspace_completion_goodput", multiplier=100, threshold=90.0)
    _bar_panel(axes[1, 0], selected, "P95 end-to-end latency", "Seconds · lower is better", "p95_end_to_end_seconds", threshold=300.0)
    _bar_panel(axes[1, 1], selected, "Worker capacity consumed", "Worker-seconds · lower is better", "worker_capacity_seconds")
    _bar_panel(axes[1, 2], selected, "SLO throughput efficiency", "SLO tasks / 1,000 worker-sec · higher is better", "slo_tasks_per_1000_worker_seconds")
    decision = "No strategy passes every gate" if selected.selected_strategy is None else f"Selected: {HIERARCHICAL_LABELS[selected.selected_strategy]}"
    figure.suptitle(f"Adaptive hierarchical Scheduler · 3 adversarial scenarios · {len(seeds)} paired seeds\n{decision}", fontsize=15)
    destination = output_path or Path(__file__).with_name("scheduler_hierarchical_comparison.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, selected


def _scenario_matrix(benchmark: HierarchicalBenchmark, metric_name: str, *, multiplier: float = 1.0) -> np.ndarray:
    return np.array([[multiplier * sum(getattr(row.metrics, metric_name) for row in benchmark.rows if row.strategy is strategy and row.scenario is scenario) / sum(1 for row in benchmark.rows if row.strategy is strategy and row.scenario is scenario) for scenario in TenantFairnessScenario] for strategy in HierarchicalStrategy])


def _heatmap(axis: plt.Axes, values: np.ndarray, title: str, *, minimum: float, maximum: float, suffix: str) -> None:
    image = axis.imshow(values, cmap="RdYlGn", vmin=minimum, vmax=maximum, aspect="auto")
    axis.set_xticks(np.arange(len(TenantFairnessScenario)), [TENANT_SCENARIO_LABELS[scenario] for scenario in TenantFairnessScenario], rotation=18, ha="right")
    axis.set_yticks(np.arange(len(HierarchicalStrategy)), [HIERARCHICAL_LABELS[strategy] for strategy in HierarchicalStrategy])
    axis.set_title(title)
    for row_index in range(values.shape[0]):
        for column_index in range(values.shape[1]):
            axis.text(column_index, row_index, f"{values[row_index, column_index]:.0f}{suffix}", ha="center", va="center", color="black")
    plt.colorbar(image, ax=axis, shrink=0.82)


def build_hierarchical_scenario_table_plot(output_path: Path | None = None, *, benchmark: HierarchicalBenchmark | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59)) -> tuple[Path, HierarchicalBenchmark]:
    selected = benchmark or run_hierarchical_benchmark(seeds=seeds)
    completion = _scenario_matrix(selected, "completion_slo_goodput", multiplier=100)
    priority = _scenario_matrix(selected, "high_priority_wait_slo_goodput", multiplier=100)
    workspace = _scenario_matrix(selected, "worst_workspace_completion_goodput", multiplier=100)
    figure, axes = plt.subplots(1, 3, figsize=(20, 7), constrained_layout=True)
    _heatmap(axes[0], completion, "Submitted completion goodput", minimum=50.0, maximum=100.0, suffix="%")
    _heatmap(axes[1], priority, "Priority wait SLO goodput", minimum=50.0, maximum=100.0, suffix="%")
    _heatmap(axes[2], workspace, "Worst-workspace goodput", minimum=20.0, maximum=100.0, suffix="%")
    figure.suptitle(f"Hierarchical Scheduler result table · {len(seeds)} paired seeds per scenario\nRejected and deferred-late tasks count as SLO failures", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_hierarchical_scenario_table.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, selected


def build_hierarchical_sensitivity_plot(output_path: Path | None = None, *, seeds: tuple[int, ...] = (11, 23, 37, 42, 59), delays: tuple[float, ...] = (0.0, 30.0, 60.0, 90.0, 120.0), factors: tuple[float, ...] = (1.25, 1.5, 1.75, 2.0, 2.5, 3.0), quota_bursts: tuple[float, ...] = (60.0, 120.0, 240.0, 480.0, 960.0)) -> tuple[Path, dict[str, tuple[HierarchicalBenchmark, ...]]]:
    delay_benchmarks = tuple(run_hierarchical_benchmark(config=HierarchicalConfig(scale_delay_seconds=value), seeds=seeds, strategies=[HierarchicalStrategy.HIERARCHICAL_SCALE]) for value in delays)
    factor_benchmarks = tuple(run_hierarchical_benchmark(config=HierarchicalConfig(scale_factor=value), seeds=seeds, strategies=[HierarchicalStrategy.HIERARCHICAL_SCALE]) for value in factors)
    quota_benchmarks = tuple(run_hierarchical_benchmark(config=HierarchicalConfig(workspace_burst_work_seconds=value), seeds=seeds, strategies=[HierarchicalStrategy.WORKSPACE_QUOTA]) for value in quota_bursts)
    figure, axes = plt.subplots(1, 3, figsize=(20, 6.5), constrained_layout=True)
    for metric_name, label, color in (("completion_slo_goodput", "Completion goodput", "tab:blue"), ("high_priority_wait_slo_goodput", "Priority SLO", "tab:orange"), ("worst_workspace_completion_goodput", "Worst workspace", "tab:green")):
        axes[0].plot(delays, [100 * getattr(benchmark.summaries[0], metric_name).mean for benchmark in delay_benchmarks], marker="o", linewidth=2, color=color, label=label)
        axes[1].plot(factors, [100 * getattr(benchmark.summaries[0], metric_name).mean for benchmark in factor_benchmarks], marker="o", linewidth=2, color=color, label=label)
    axes[0].axhline(95.0, color="black", linestyle="--", linewidth=1.1, label="Completion / priority gate")
    axes[0].axhline(90.0, color="black", linestyle=":", linewidth=1.1, label="Worst-workspace gate")
    axes[1].axhline(95.0, color="black", linestyle="--", linewidth=1.1)
    axes[1].axhline(90.0, color="black", linestyle=":", linewidth=1.1)
    axes[0].set_title("Scale-up delay sensitivity")
    axes[0].set_xlabel("Scale delay (seconds)")
    axes[1].set_title("Scale factor sensitivity")
    axes[1].set_xlabel("Scale factor")
    axes[0].set_ylabel("Goodput (%) · higher is better")
    axes[0].legend(loc="lower left")
    quota_goodput = [100 * benchmark.summaries[0].completion_slo_goodput.mean for benchmark in quota_benchmarks]
    quota_worst = [100 * benchmark.summaries[0].worst_workspace_completion_goodput.mean for benchmark in quota_benchmarks]
    axes[2].plot(quota_bursts, quota_goodput, marker="o", linewidth=2, color="tab:blue", label="Completion goodput")
    axes[2].plot(quota_bursts, quota_worst, marker="s", linewidth=2, color="tab:green", label="Worst workspace")
    axes[2].axhline(95.0, color="black", linestyle="--", linewidth=1.1)
    axes[2].axhline(90.0, color="black", linestyle=":", linewidth=1.1)
    axes[2].set_title("Static workspace quota sensitivity")
    axes[2].set_xlabel("Workspace burst allowance (work-seconds)")
    axes[2].legend(loc="lower right")
    for axis in axes:
        axis.set_ylim(50.0, 102.0)
        axis.grid(alpha=0.25)
    figure.suptitle("Hierarchical Scheduler sensitivity · hard gate requires every paired run\nDelay 30s and scale factor 2.0 are the robust operating point; static quota never clears every gate", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_hierarchical_sensitivity.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, {"delay": delay_benchmarks, "factor": factor_benchmarks, "quota": quota_benchmarks}


def main() -> None:
    comparison_path, benchmark = build_hierarchical_comparison_plot()
    scenario_path, _ = build_hierarchical_scenario_table_plot(benchmark=benchmark)
    sensitivity_path, _ = build_hierarchical_sensitivity_plot()
    for summary in benchmark.summaries:
        print(f"{HIERARCHICAL_LABELS[summary.strategy]}: admitted={100 * summary.admitted_rate.mean:.1f}%, goodput={100 * summary.completion_slo_goodput.mean:.1f}%, priority SLO={100 * summary.high_priority_wait_slo_goodput.mean:.1f}%, worst workspace={100 * summary.worst_workspace_completion_goodput.mean:.1f}%, P95={summary.p95_end_to_end_seconds.mean:.1f}s, capacity={summary.worker_capacity_seconds.mean:.0f}, efficiency={summary.slo_tasks_per_1000_worker_seconds.mean:.1f}, scale={100 * summary.scale_activation_rate:.1f}%, gate={100 * summary.hard_gate_pass_rate:.1f}%")
    print(f"Selected strategy: {HIERARCHICAL_LABELS[benchmark.selected_strategy] if benchmark.selected_strategy is not None else 'none'}")
    print(comparison_path)
    print(scenario_path)
    print(sensitivity_path)


if __name__ == "__main__":
    main()
