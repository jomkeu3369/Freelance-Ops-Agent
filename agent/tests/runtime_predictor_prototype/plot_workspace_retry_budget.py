from __future__ import annotations

from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .retry_checkpoint_simulation import RetryBudgetScope
from .tenant_fairness_simulation import TENANT_SCENARIO_LABELS, TenantFairnessScenario
from .workspace_retry_budget_simulation import RETRY_SCOPE_LABELS, WorkspaceRetryBudgetBenchmark, WorkspaceRetryBudgetConfig, WorkspaceRetryBudgetSummary, build_workspace_retry_budget_benchmark, summarize_workspace_retry_budget


SCOPE_COLORS = ("tab:gray", "tab:orange", "tab:green", "tab:blue")


def _bar_panel(axis: plt.Axes, benchmark: WorkspaceRetryBudgetBenchmark, title: str, ylabel: str, metric_name: str, *, multiplier: float = 1.0, threshold: float | None = None, lower_is_better: bool = False) -> None:
    positions = np.arange(len(benchmark.summaries))
    metrics = [getattr(summary, metric_name) for summary in benchmark.summaries]
    values = [float(metric.mean if hasattr(metric, "mean") else metric) * multiplier for metric in metrics]
    errors = [float(metric.ci95 if hasattr(metric, "ci95") else 0.0) * multiplier for metric in metrics]
    axis.bar(positions, values, yerr=errors, capsize=4, color=SCOPE_COLORS)
    if threshold is not None:
        axis.axhline(threshold, color="black", linestyle="--", linewidth=1.1, label="Operational gate")
        axis.legend(loc="upper right" if lower_is_better else "lower left")
    axis.set_xticks(positions, [RETRY_SCOPE_LABELS[summary.scope] for summary in benchmark.summaries], rotation=22, ha="right")
    axis.set_title(title)
    axis.set_ylabel(ylabel)
    axis.grid(axis="y", alpha=0.25)


def build_workspace_retry_budget_comparison_plot(output_path: Path | None = None, *, benchmark: WorkspaceRetryBudgetBenchmark | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59)) -> tuple[Path, WorkspaceRetryBudgetBenchmark]:
    selected = benchmark or build_workspace_retry_budget_benchmark(seeds=seeds)
    figure, axes = plt.subplots(2, 3, figsize=(20, 11), constrained_layout=True)
    _bar_panel(axes[0, 0], selected, "Submitted completion goodput", "Goodput (%) · higher is better", "submitted_completion_goodput", multiplier=100, threshold=100 * selected.config.minimum_submitted_goodput)
    _bar_panel(axes[0, 1], selected, "Healthy-workspace goodput", "Healthy goodput (%) · higher is better", "healthy_workspace_completion_goodput", multiplier=100, threshold=100 * selected.config.minimum_healthy_goodput)
    _bar_panel(axes[0, 2], selected, "Noisy-workspace bounded goodput", "Noisy goodput (%) · higher is better", "noisy_workspace_completion_goodput", multiplier=100, threshold=100 * selected.config.minimum_noisy_goodput)
    _bar_panel(axes[1, 0], selected, "Healthy budget exhaustion", "Healthy tasks (%) · lower is better", "healthy_retry_budget_exhaustion_rate", multiplier=100, threshold=100 * selected.config.maximum_healthy_budget_exhaustion, lower_is_better=True)
    _bar_panel(axes[1, 1], selected, "Retry demand amplification", "Executed / original demand · lower is better", "demand_amplification", threshold=selected.config.maximum_demand_amplification, lower_is_better=True)
    _bar_panel(axes[1, 2], selected, "Counterfactual gate pass", "Expected pass (%) · higher is better", "expected_gate_pass_rate", multiplier=100, threshold=90.0)
    decision = "No retry scope passes every gate" if selected.selected_scope is None else f"Selected: {RETRY_SCOPE_LABELS[selected.selected_scope]}"
    figure.suptitle(f"Workspace retry token bucket · noisy attempt failure 35% · scale success 90%\n{decision}", fontsize=15)
    destination = output_path or Path(__file__).with_name("scheduler_workspace_retry_budget_comparison.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, selected


def _scenario_summary(benchmark: WorkspaceRetryBudgetBenchmark, scope: RetryBudgetScope, scenario: TenantFairnessScenario) -> WorkspaceRetryBudgetSummary:
    success = [row for row in benchmark.success_rows if row.scenario is scenario]
    failure = [row for row in benchmark.failure_rows if row.scenario is scenario]
    return summarize_workspace_retry_budget(success, failure, scope, benchmark.config.scale_success_probability)


def _heatmap(axis: plt.Axes, values: np.ndarray, title: str, *, minimum: float, maximum: float, suffix: str) -> None:
    image = axis.imshow(values, cmap="RdYlGn", vmin=minimum, vmax=maximum, aspect="auto")
    axis.set_xticks(np.arange(len(TenantFairnessScenario)), [TENANT_SCENARIO_LABELS[scenario] for scenario in TenantFairnessScenario], rotation=18, ha="right")
    axis.set_yticks(np.arange(len(RetryBudgetScope)), [RETRY_SCOPE_LABELS[scope] for scope in RetryBudgetScope])
    axis.set_title(title)
    for row_index in range(values.shape[0]):
        for column_index in range(values.shape[1]):
            axis.text(column_index, row_index, f"{values[row_index, column_index]:.1f}{suffix}", ha="center", va="center", color="black")
    plt.colorbar(image, ax=axis, shrink=0.82)


def build_workspace_retry_budget_table_plot(output_path: Path | None = None, *, benchmark: WorkspaceRetryBudgetBenchmark | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59)) -> tuple[Path, WorkspaceRetryBudgetBenchmark]:
    selected = benchmark or build_workspace_retry_budget_benchmark(seeds=seeds)
    healthy = np.array([[100 * _scenario_summary(selected, scope, scenario).healthy_workspace_completion_goodput.mean for scenario in TenantFairnessScenario] for scope in RetryBudgetScope])
    noisy = np.array([[100 * _scenario_summary(selected, scope, scenario).noisy_workspace_completion_goodput.mean for scenario in TenantFairnessScenario] for scope in RetryBudgetScope])
    gate = np.array([[100 * _scenario_summary(selected, scope, scenario).expected_gate_pass_rate for scenario in TenantFairnessScenario] for scope in RetryBudgetScope])
    figure, axes = plt.subplots(1, 3, figsize=(20, 7), constrained_layout=True)
    _heatmap(axes[0], healthy, "Healthy-workspace goodput", minimum=90.0, maximum=100.0, suffix="%")
    _heatmap(axes[1], noisy, "Noisy-workspace bounded goodput", minimum=50.0, maximum=100.0, suffix="%")
    _heatmap(axes[2], gate, "Counterfactual gate pass", minimum=0.0, maximum=100.0, suffix="%")
    figure.suptitle("Workspace retry budget result table · submitted failures stay in the denominator\nGlobal-only budget allows the first noisy workspace to consume healthy retry capacity", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_workspace_retry_budget_table.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, selected


def build_workspace_retry_budget_sensitivity_plot(output_path: Path | None = None, *, seeds: tuple[int, ...] = (11, 23, 37, 42, 59), capacities: tuple[float, ...] = (4.0, 8.0, 12.0, 16.0, 24.0), refill_rates: tuple[float, ...] = (0.025, 0.05, 0.10, 0.20, 0.40), distributed_failure_rates: tuple[float, ...] = (0.05, 0.10, 0.15, 0.20, 0.30)) -> tuple[Path, dict[str, tuple[WorkspaceRetryBudgetSummary, ...]]]:
    scope = RetryBudgetScope.HIERARCHICAL_TOKEN_BUCKET
    capacity = tuple(build_workspace_retry_budget_benchmark(config=WorkspaceRetryBudgetConfig(workspace_bucket_capacity=value), seeds=seeds, scopes=[scope]).summaries[0] for value in capacities)
    refill = tuple(build_workspace_retry_budget_benchmark(config=WorkspaceRetryBudgetConfig(workspace_refill_tokens_per_second=value), seeds=seeds, scopes=[scope]).summaries[0] for value in refill_rates)
    workspace_only = tuple(build_workspace_retry_budget_benchmark(config=WorkspaceRetryBudgetConfig(healthy_failure_probability=value), seeds=seeds, scopes=[RetryBudgetScope.WORKSPACE_TOKEN_BUCKET]).summaries[0] for value in distributed_failure_rates)
    hierarchical = tuple(build_workspace_retry_budget_benchmark(config=WorkspaceRetryBudgetConfig(healthy_failure_probability=value), seeds=seeds, scopes=[scope]).summaries[0] for value in distributed_failure_rates)
    figure, axes = plt.subplots(1, 3, figsize=(20, 6.5), constrained_layout=True)
    for metric_name, label, marker in (("healthy_workspace_completion_goodput", "Healthy goodput", "o"), ("noisy_workspace_completion_goodput", "Noisy goodput", "s"), ("expected_gate_pass_rate", "Gate pass", "D")):
        axes[0].plot(capacities, [100 * float(getattr(summary, metric_name).mean if hasattr(getattr(summary, metric_name), "mean") else getattr(summary, metric_name)) for summary in capacity], marker=marker, linewidth=2, label=label)
        axes[1].plot(refill_rates, [100 * float(getattr(summary, metric_name).mean if hasattr(getattr(summary, metric_name), "mean") else getattr(summary, metric_name)) for summary in refill], marker=marker, linewidth=2, label=label)
    axes[0].set_title("Workspace bucket capacity boundary")
    axes[0].set_xlabel("Retry tokens per workspace")
    axes[1].set_title("Workspace refill boundary")
    axes[1].set_xlabel("Refill tokens per second")
    axes[0].set_ylabel("Rate (%) · higher is better")
    axes[0].legend(loc="lower right", fontsize=8)
    axes[2].plot(distributed_failure_rates, [summary.demand_amplification.mean for summary in workspace_only], marker="o", linewidth=2, label="Workspace-only amplification")
    axes[2].plot(distributed_failure_rates, [summary.demand_amplification.mean for summary in hierarchical], marker="s", linewidth=2, label="Hierarchical amplification")
    axes[2].axhline(1.25, color="black", linestyle="--", linewidth=1.0, label="Amplification gate")
    axes[2].set_title("Distributed retry pressure")
    axes[2].set_xlabel("Healthy-workspace attempt failure probability")
    axes[2].set_ylabel("Executed / original demand · lower is better")
    axes[2].legend(loc="upper left", fontsize=8)
    for axis in axes[:2]:
        axis.axhline(90.0, color="black", linestyle="--", linewidth=1.0)
        axis.grid(alpha=0.25)
    axes[2].grid(alpha=0.25)
    figure.suptitle("Hierarchical retry token bucket sensitivity · local isolation plus aggregate safety cap\n12 workspace tokens and 0.10 token/s refill are the tested operating point", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_workspace_retry_budget_sensitivity.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, {"capacity": capacity, "refill": refill, "workspace_only": workspace_only, "hierarchical": hierarchical}


def main() -> None:
    comparison_path, benchmark = build_workspace_retry_budget_comparison_plot()
    table_path, _ = build_workspace_retry_budget_table_plot(benchmark=benchmark)
    sensitivity_path, _ = build_workspace_retry_budget_sensitivity_plot()
    for summary in benchmark.summaries:
        print(f"{RETRY_SCOPE_LABELS[summary.scope]}: completion={100 * summary.submitted_completion_goodput.mean:.1f}%, healthy={100 * summary.healthy_workspace_completion_goodput.mean:.1f}%, noisy={100 * summary.noisy_workspace_completion_goodput.mean:.1f}%, amplification={summary.demand_amplification.mean:.3f}, healthy exhaustion={100 * summary.healthy_retry_budget_exhaustion_rate.mean:.1f}%, cost=${summary.estimated_worker_cost.mean:.3f}, gate={100 * summary.expected_gate_pass_rate:.1f}%")
    print(f"Selected scope: {RETRY_SCOPE_LABELS[benchmark.selected_scope] if benchmark.selected_scope is not None else 'none'}")
    print(comparison_path)
    print(table_path)
    print(sensitivity_path)


if __name__ == "__main__":
    main()
