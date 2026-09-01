from __future__ import annotations

from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .scheduler_simulation import MetricEstimate, SchedulingPolicy, _estimate
from .tenant_fairness_simulation import TENANT_FAIRNESS_POLICY_LABELS, TENANT_SCENARIO_LABELS, TenantFairnessBenchmark, TenantFairnessRow, TenantFairnessScenario, TenantFairnessSummary, run_tenant_fairness_benchmark


POLICY_COLORS = ("tab:gray", "tab:orange", "tab:red", "tab:green", "tab:blue")


def _bar_panel(axis: plt.Axes, summaries: tuple[TenantFairnessSummary, ...], title: str, ylabel: str, metric_name: str, *, multiplier: float = 1.0, threshold: float | None = None) -> None:
    positions = np.arange(len(summaries))
    values = [getattr(summary, metric_name).mean * multiplier for summary in summaries]
    errors = [getattr(summary, metric_name).ci95 * multiplier for summary in summaries]
    axis.bar(positions, values, yerr=errors, capsize=4, color=POLICY_COLORS)
    if threshold is not None:
        axis.axhline(threshold, color="black", linestyle="--", linewidth=1.2, label="Gate")
        axis.legend(loc="upper left")
    axis.set_xticks(positions, [TENANT_FAIRNESS_POLICY_LABELS[summary.policy] for summary in summaries], rotation=20, ha="right")
    axis.set_title(title)
    axis.set_ylabel(ylabel)
    axis.grid(axis="y", alpha=0.25)


def build_tenant_fairness_comparison_plot(output_path: Path | None = None, *, benchmark: TenantFairnessBenchmark | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59)) -> tuple[Path, TenantFairnessBenchmark]:
    selected = benchmark or run_tenant_fairness_benchmark(seeds=seeds)
    figure, axes = plt.subplots(2, 3, figsize=(19, 11), constrained_layout=True)
    _bar_panel(axes[0, 0], selected.summaries, "Mean completion", "Seconds · lower is better", "mean_completion_seconds")
    _bar_panel(axes[0, 1], selected.summaries, "Worst-workspace P95 wait", "Seconds · lower is better", "worst_workspace_p95_wait_seconds", threshold=300.0)
    _bar_panel(axes[0, 2], selected.summaries, "Maximum task wait", "Seconds · lower is better", "maximum_wait_seconds", threshold=600.0)
    _bar_panel(axes[1, 0], selected.summaries, "Workspace slowdown equality", "Jain index · higher is better", "fairness_index", threshold=0.90)
    _bar_panel(axes[1, 1], selected.summaries, "High-priority wait violations", "Priority 4-5 tasks (%)", "high_priority_violation_rate", multiplier=100, threshold=5.0)
    _bar_panel(axes[1, 2], selected.summaries, "Stress-window service-share error", "Maximum absolute share error", "stress_service_share_error", threshold=0.20)
    decision = "No policy passes every adversarial gate" if selected.selected_policy is None else f"Selected: {TENANT_FAIRNESS_POLICY_LABELS[selected.selected_policy]}"
    figure.suptitle(f"Multi-tenant scheduler adversarial benchmark · 3 scenarios · {len(seeds)} paired seeds\n{decision} · Bounded Fair candidate remains experimental", fontsize=15)
    destination = output_path or Path(__file__).with_name("scheduler_tenant_fairness_comparison.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, selected


def _scenario_estimate(rows: tuple[TenantFairnessRow, ...], scenario: TenantFairnessScenario, policy: SchedulingPolicy, metric_name: str) -> MetricEstimate:
    values = [float(getattr(row, metric_name)) for row in rows if row.scenario is scenario and row.policy is policy]
    return _estimate(values)


def _heatmap(axis: plt.Axes, values: np.ndarray, policies: tuple[SchedulingPolicy, ...], title: str, value_format: str, *, minimum: float, maximum: float, suffix: str = "") -> None:
    image = axis.imshow(values, cmap="RdYlGn_r", vmin=minimum, vmax=maximum, aspect="auto")
    axis.set_xticks(np.arange(len(TenantFairnessScenario)), [TENANT_SCENARIO_LABELS[scenario] for scenario in TenantFairnessScenario], rotation=18, ha="right")
    axis.set_yticks(np.arange(values.shape[0]), [TENANT_FAIRNESS_POLICY_LABELS[policy] for policy in policies])
    axis.set_title(title)
    for row_index in range(values.shape[0]):
        for column_index in range(values.shape[1]):
            axis.text(column_index, row_index, f"{values[row_index, column_index]:{value_format}}{suffix}", ha="center", va="center", color="black")
    plt.colorbar(image, ax=axis, shrink=0.82)


def build_tenant_fairness_scenario_table_plot(output_path: Path | None = None, *, benchmark: TenantFairnessBenchmark | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59)) -> tuple[Path, TenantFairnessBenchmark]:
    selected = benchmark or run_tenant_fairness_benchmark(seeds=seeds)
    policies = tuple(summary.policy for summary in selected.summaries)
    scenarios = tuple(TenantFairnessScenario)
    mean_completion = np.array([[_scenario_estimate(selected.rows, scenario, policy, "mean_completion_seconds").mean for scenario in scenarios] for policy in policies])
    worst_p95 = np.array([[_scenario_estimate(selected.rows, scenario, policy, "worst_workspace_p95_wait_seconds").mean for scenario in scenarios] for policy in policies])
    high_priority = np.array([[100 * _scenario_estimate(selected.rows, scenario, policy, "high_priority_violation_rate").mean for scenario in scenarios] for policy in policies])
    figure, axes = plt.subplots(1, 3, figsize=(20, 7), constrained_layout=True)
    _heatmap(axes[0], mean_completion, policies, "Mean completion by scenario", ".0f", minimum=0.0, maximum=max(300.0, float(mean_completion.max())), suffix="s")
    _heatmap(axes[1], worst_p95, policies, "Worst-workspace P95 wait", ".0f", minimum=0.0, maximum=max(450.0, float(worst_p95.max())), suffix="s")
    _heatmap(axes[2], high_priority, policies, "High-priority wait violations", ".0f", minimum=0.0, maximum=max(50.0, float(high_priority.max())), suffix="%")
    figure.suptitle(f"Adversarial tenant result table · {len(seeds)} paired seeds per scenario\nLower values are better · identical workloads replayed for every policy", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_tenant_fairness_scenario_table.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, selected


def main() -> None:
    comparison_path, benchmark = build_tenant_fairness_comparison_plot()
    scenario_path, _ = build_tenant_fairness_scenario_table_plot(benchmark=benchmark)
    for summary in benchmark.summaries:
        print(f"{TENANT_FAIRNESS_POLICY_LABELS[summary.policy]}: completion={summary.mean_completion_seconds.mean:.1f}s, worst workspace P95={summary.worst_workspace_p95_wait_seconds.mean:.1f}s, max wait={summary.maximum_wait_seconds.mean:.1f}s, fairness={summary.fairness_index.mean:.3f}, SLO={100 * summary.completion_slo_rate.mean:.1f}%, priority violations={100 * summary.high_priority_violation_rate.mean:.1f}%, share error={summary.stress_service_share_error.mean:.3f}, gate pass={100 * summary.gate_pass_rate:.1f}%")
    print(f"Selected policy: {TENANT_FAIRNESS_POLICY_LABELS[benchmark.selected_policy] if benchmark.selected_policy is not None else 'none'}")
    print(comparison_path)
    print(scenario_path)


if __name__ == "__main__":
    main()
