from __future__ import annotations

from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .autoscaling_reliability_simulation import SCALING_RELIABILITY_LABELS, ExpectedScalingReliabilityBenchmark, ReliabilityWorkload, ScalingReliabilityConfig, ScalingReliabilityStrategy, ScalingReliabilitySummary, generate_reliability_workloads, mix_scaling_reliability_benchmarks, run_scaling_reliability_benchmark
from .overload_simulation import AdmissionConfig
from .scheduler_simulation import SchedulerExperimentConfig


STRATEGY_COLORS = ("tab:gray", "tab:orange", "tab:blue", "tab:green", "tab:purple")


def _bar_panel(axis: plt.Axes, summaries: tuple[ScalingReliabilitySummary, ...], title: str, ylabel: str, metric_name: str, *, multiplier: float = 1.0, threshold: float | None = None) -> None:
    positions = np.arange(len(summaries))
    values = [getattr(summary, metric_name).mean * multiplier for summary in summaries]
    errors = [getattr(summary, metric_name).ci95 * multiplier for summary in summaries]
    axis.bar(positions, values, yerr=errors, capsize=4, color=STRATEGY_COLORS)
    if threshold is not None:
        axis.axhline(threshold, color="black", linestyle="--", linewidth=1.2, label="Target")
        axis.legend(loc="upper left")
    axis.set_xticks(positions, [SCALING_RELIABILITY_LABELS[summary.strategy] for summary in summaries], rotation=20, ha="right")
    axis.set_title(title)
    axis.set_ylabel(ylabel)
    axis.grid(axis="y", alpha=0.25)


def build_scaling_reliability_comparison_plot(output_path: Path | None = None, *, config: SchedulerExperimentConfig | None = None, admission_config: AdmissionConfig | None = None, reliability_config: ScalingReliabilityConfig | None = None, seeds: tuple[int, ...] = (7, 11, 17, 23, 29, 37, 42, 47, 53, 59, 67, 71, 79, 83, 97), workloads: tuple[ReliabilityWorkload, ...] | None = None) -> tuple[Path, ExpectedScalingReliabilityBenchmark, tuple[ReliabilityWorkload, ...]]:
    selected_config = config or SchedulerExperimentConfig(tasks_per_workspace=60, mean_interarrival_seconds=12.0, training_samples=1_200)
    selected_admission = admission_config or AdmissionConfig()
    selected_reliability = reliability_config or ScalingReliabilityConfig()
    selected_workloads = workloads or generate_reliability_workloads(selected_config, seeds)
    failure_benchmark = run_scaling_reliability_benchmark(selected_config, admission_config=selected_admission, reliability_config=ScalingReliabilityConfig(trigger_drain_seconds=selected_reliability.trigger_drain_seconds, scale_up_delay_seconds=selected_reliability.scale_up_delay_seconds, scale_hard_deadline_seconds=selected_reliability.scale_hard_deadline_seconds, scale_factor=selected_reliability.scale_factor, scale_success_probability=0.0, scale_down_cooldown_seconds=selected_reliability.scale_down_cooldown_seconds, minimum_scale_billing_seconds=selected_reliability.minimum_scale_billing_seconds, worker_hour_cost=selected_reliability.worker_hour_cost), seeds=seeds, workloads=selected_workloads)
    success_benchmark = run_scaling_reliability_benchmark(selected_config, admission_config=selected_admission, reliability_config=ScalingReliabilityConfig(trigger_drain_seconds=selected_reliability.trigger_drain_seconds, scale_up_delay_seconds=selected_reliability.scale_up_delay_seconds, scale_hard_deadline_seconds=selected_reliability.scale_hard_deadline_seconds, scale_factor=selected_reliability.scale_factor, scale_success_probability=1.0, scale_down_cooldown_seconds=selected_reliability.scale_down_cooldown_seconds, minimum_scale_billing_seconds=selected_reliability.minimum_scale_billing_seconds, worker_hour_cost=selected_reliability.worker_hour_cost), seeds=seeds, workloads=selected_workloads)
    benchmark = mix_scaling_reliability_benchmarks(failure_benchmark, success_benchmark, selected_reliability.scale_success_probability)
    summaries = benchmark.summaries
    figure, axes = plt.subplots(2, 3, figsize=(19, 11), constrained_layout=True)
    _bar_panel(axes[0, 0], summaries, "P95 end-to-end completion", "Seconds · lower is better", "p95_end_to_end_seconds", threshold=selected_admission.completion_slo_seconds)
    _bar_panel(axes[0, 1], summaries, "Tasks completed within SLO", "All submitted tasks (%)", "completion_slo_rate", multiplier=100, threshold=95)
    _bar_panel(axes[0, 2], summaries, "Rejected tasks", "Submitted tasks (%)", "rejected_rate", multiplier=100)
    _bar_panel(axes[1, 0], summaries, "Priority 4-5 acceptance", "High-priority tasks (%)", "high_priority_acceptance_rate", multiplier=100, threshold=99)
    _bar_panel(axes[1, 1], summaries, "Estimated worker cost", "USD per workload · lower is better", "estimated_worker_cost")
    _bar_panel(axes[1, 2], summaries, "SLO goodput per worker dollar", "SLO tasks / USD · higher is better", "slo_tasks_per_worker_dollar")
    figure.suptitle(f"Scale failure and fallback benchmark · offered load {benchmark.offered_load_ratio.mean:.2f} · {len(seeds)} paired seeds\nScale success {100 * selected_reliability.scale_success_probability:.0f}% · target {selected_reliability.scale_up_delay_seconds:.0f}s · hard deadline {selected_reliability.scale_hard_deadline_seconds:.0f}s · worker ${selected_reliability.worker_hour_cost:.2f}/hour", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_scaling_reliability_comparison.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, benchmark, selected_workloads


def build_scale_success_sensitivity_plot(output_path: Path | None = None, *, config: SchedulerExperimentConfig | None = None, admission_config: AdmissionConfig | None = None, reliability_config: ScalingReliabilityConfig | None = None, probabilities: tuple[float, ...] = (0.0, 0.25, 0.5, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0), seeds: tuple[int, ...] = (7, 11, 17, 23, 29, 37, 42, 47, 53, 59, 67, 71, 79, 83, 97), workloads: tuple[ReliabilityWorkload, ...] | None = None) -> tuple[Path, dict[float, ExpectedScalingReliabilityBenchmark]]:
    selected_config = config or SchedulerExperimentConfig(tasks_per_workspace=60, mean_interarrival_seconds=12.0, training_samples=1_200)
    selected_admission = admission_config or AdmissionConfig()
    selected_reliability = reliability_config or ScalingReliabilityConfig()
    selected_workloads = workloads or generate_reliability_workloads(selected_config, seeds)
    strategies = (ScalingReliabilityStrategy.SCALE_ONLY, ScalingReliabilityStrategy.SHED_THEN_SCALE, ScalingReliabilityStrategy.SCALE_THEN_FALLBACK_SHED)
    failure_config = ScalingReliabilityConfig(trigger_drain_seconds=selected_reliability.trigger_drain_seconds, scale_up_delay_seconds=selected_reliability.scale_up_delay_seconds, scale_hard_deadline_seconds=selected_reliability.scale_hard_deadline_seconds, scale_factor=selected_reliability.scale_factor, scale_success_probability=0.0, scale_down_cooldown_seconds=selected_reliability.scale_down_cooldown_seconds, minimum_scale_billing_seconds=selected_reliability.minimum_scale_billing_seconds, worker_hour_cost=selected_reliability.worker_hour_cost)
    success_config = ScalingReliabilityConfig(trigger_drain_seconds=selected_reliability.trigger_drain_seconds, scale_up_delay_seconds=selected_reliability.scale_up_delay_seconds, scale_hard_deadline_seconds=selected_reliability.scale_hard_deadline_seconds, scale_factor=selected_reliability.scale_factor, scale_success_probability=1.0, scale_down_cooldown_seconds=selected_reliability.scale_down_cooldown_seconds, minimum_scale_billing_seconds=selected_reliability.minimum_scale_billing_seconds, worker_hour_cost=selected_reliability.worker_hour_cost)
    failure_benchmark = run_scaling_reliability_benchmark(selected_config, admission_config=selected_admission, reliability_config=failure_config, strategies=strategies, seeds=seeds, workloads=selected_workloads)
    success_benchmark = run_scaling_reliability_benchmark(selected_config, admission_config=selected_admission, reliability_config=success_config, strategies=strategies, seeds=seeds, workloads=selected_workloads)
    benchmarks = {probability: mix_scaling_reliability_benchmarks(failure_benchmark, success_benchmark, probability) for probability in probabilities}
    figure, axes = plt.subplots(2, 2, figsize=(16, 10), constrained_layout=True)
    panels = ((axes[0, 0], "Tasks completed within SLO", "All submitted tasks (%)", "completion_slo_rate", 100.0), (axes[0, 1], "P95 end-to-end completion", "Seconds", "p95_end_to_end_seconds", 1.0), (axes[1, 0], "Rejected tasks", "Submitted tasks (%)", "rejected_rate", 100.0), (axes[1, 1], "Estimated worker cost", "USD per workload", "estimated_worker_cost", 1.0))
    for axis, title, ylabel, metric_name, multiplier in panels:
        for strategy_index, strategy in enumerate(strategies):
            values = [getattr(next(summary for summary in benchmark.summaries if summary.strategy is strategy), metric_name).mean * multiplier for benchmark in benchmarks.values()]
            axis.plot([100 * probability for probability in probabilities], values, marker="o", linewidth=2, color=STRATEGY_COLORS[strategy_index + 2], label=SCALING_RELIABILITY_LABELS[strategy])
        axis.set_title(title)
        axis.set_xlabel("Scale success probability (%)")
        axis.set_ylabel(ylabel)
        axis.grid(alpha=0.25)
    axes[0, 0].axhline(95, color="black", linestyle="--", linewidth=1.2, label="Goodput target")
    axes[0, 1].axhline(selected_admission.completion_slo_seconds, color="black", linestyle="--", linewidth=1.2, label="Completion SLO")
    axes[0, 0].legend(fontsize=9)
    axes[0, 1].legend(fontsize=9)
    figure.suptitle(f"Scale success sensitivity · offered load {next(iter(benchmarks.values())).offered_load_ratio.mean:.2f} · {len(seeds)} paired seeds\nScale target {selected_reliability.scale_up_delay_seconds:.0f}s · fallback deadline {selected_reliability.scale_hard_deadline_seconds:.0f}s", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_scale_success_sensitivity.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, benchmarks


def build_scaling_cost_sensitivity_plot(output_path: Path | None = None, *, config: SchedulerExperimentConfig | None = None, admission_config: AdmissionConfig | None = None, reliability_config: ScalingReliabilityConfig | None = None, cooldowns: tuple[float, ...] = (0.0, 60.0, 120.0, 300.0), minimum_billings: tuple[float, ...] = (60.0, 300.0, 600.0), seeds: tuple[int, ...] = (7, 11, 17, 23, 29, 37, 42, 47, 53, 59, 67, 71, 79, 83, 97), workloads: tuple[ReliabilityWorkload, ...] | None = None) -> tuple[Path, dict[tuple[float, float], ExpectedScalingReliabilityBenchmark]]:
    selected_config = config or SchedulerExperimentConfig(tasks_per_workspace=60, mean_interarrival_seconds=12.0, training_samples=1_200)
    selected_admission = admission_config or AdmissionConfig()
    selected_reliability = reliability_config or ScalingReliabilityConfig(scale_success_probability=0.9)
    selected_workloads = workloads or generate_reliability_workloads(selected_config, seeds)
    strategies = tuple([ScalingReliabilityStrategy.SCALE_THEN_FALLBACK_SHED])
    benchmarks: dict[tuple[float, float], ExpectedScalingReliabilityBenchmark] = {}
    for cooldown in cooldowns:
        for minimum_billing in minimum_billings:
            base_values = dict(trigger_drain_seconds=selected_reliability.trigger_drain_seconds, scale_up_delay_seconds=selected_reliability.scale_up_delay_seconds, scale_hard_deadline_seconds=selected_reliability.scale_hard_deadline_seconds, scale_factor=selected_reliability.scale_factor, scale_down_cooldown_seconds=cooldown, minimum_scale_billing_seconds=minimum_billing, worker_hour_cost=selected_reliability.worker_hour_cost)
            failure_config = ScalingReliabilityConfig(scale_success_probability=0.0, **base_values)
            success_config = ScalingReliabilityConfig(scale_success_probability=1.0, **base_values)
            failure = run_scaling_reliability_benchmark(selected_config, admission_config=selected_admission, reliability_config=failure_config, strategies=strategies, seeds=seeds, workloads=selected_workloads)
            success = run_scaling_reliability_benchmark(selected_config, admission_config=selected_admission, reliability_config=success_config, strategies=strategies, seeds=seeds, workloads=selected_workloads)
            benchmarks[(cooldown, minimum_billing)] = mix_scaling_reliability_benchmarks(failure, success, selected_reliability.scale_success_probability)
    goodput = np.array([[100 * benchmarks[(cooldown, minimum_billing)].summaries[0].completion_slo_rate.mean for minimum_billing in minimum_billings] for cooldown in cooldowns])
    costs = np.array([[benchmarks[(cooldown, minimum_billing)].summaries[0].estimated_worker_cost.mean for minimum_billing in minimum_billings] for cooldown in cooldowns])
    figure, axes = plt.subplots(1, 2, figsize=(14, 6), constrained_layout=True)
    panels = ((axes[0], goodput, "Tasks completed within SLO", "All submitted tasks (%)", ".1f"), (axes[1], costs, "Estimated worker cost", "USD per workload", ".3f"))
    for axis, values, title, colorbar_label, number_format in panels:
        image = axis.imshow(values, aspect="auto", cmap="viridis")
        axis.set_xticks(range(len(minimum_billings)), [f"{value:.0f}" for value in minimum_billings])
        axis.set_yticks(range(len(cooldowns)), [f"{value:.0f}" for value in cooldowns])
        axis.set_xlabel("Minimum scale billing (seconds)")
        axis.set_ylabel("Scale-down cooldown (seconds)")
        axis.set_title(title)
        figure.colorbar(image, ax=axis, label=colorbar_label)
        for row_index in range(len(cooldowns)):
            for column_index in range(len(minimum_billings)):
                axis.text(column_index, row_index, format(values[row_index, column_index], number_format), ha="center", va="center", color="white" if values[row_index, column_index] < np.median(values) else "black")
    figure.suptitle(f"Scale-down cost sensitivity · Scale then fallback shed · offered load {next(iter(benchmarks.values())).offered_load_ratio.mean:.2f}\nScale success {100 * selected_reliability.scale_success_probability:.0f}% · {len(seeds)} paired seeds · worker ${selected_reliability.worker_hour_cost:.2f}/hour", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_scaling_cost_sensitivity.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, benchmarks


def main() -> None:
    comparison_path, benchmark, workloads = build_scaling_reliability_comparison_plot()
    print(f"Offered load: {benchmark.offered_load_ratio.mean:.2f}")
    for summary in benchmark.summaries:
        print(f"{SCALING_RELIABILITY_LABELS[summary.strategy]}: scale success={100 * summary.scale_success_rate:.1f}%, fallback={100 * summary.fallback_activation_rate:.1f}%, rejected={100 * summary.rejected_rate.mean:.1f}%, p95={summary.p95_end_to_end_seconds.mean:.1f}s, SLO goodput={100 * summary.completion_slo_rate.mean:.1f}%, worker cost=${summary.estimated_worker_cost.mean:.3f}, SLO tasks/$={summary.slo_tasks_per_worker_dollar.mean:.1f}")
    print(comparison_path)
    sensitivity_path, benchmarks = build_scale_success_sensitivity_plot(workloads=workloads)
    for probability, probability_benchmark in benchmarks.items():
        scale_only = next(summary for summary in probability_benchmark.summaries if summary.strategy is ScalingReliabilityStrategy.SCALE_ONLY)
        fallback = next(summary for summary in probability_benchmark.summaries if summary.strategy is ScalingReliabilityStrategy.SCALE_THEN_FALLBACK_SHED)
        print(f"Success {100 * probability:.0f}%: scale-only goodput={100 * scale_only.completion_slo_rate.mean:.1f}%, scale-only p95={scale_only.p95_end_to_end_seconds.mean:.1f}s, fallback goodput={100 * fallback.completion_slo_rate.mean:.1f}%, fallback p95={fallback.p95_end_to_end_seconds.mean:.1f}s")
    print(sensitivity_path)
    cost_path, cost_benchmarks = build_scaling_cost_sensitivity_plot(workloads=workloads)
    for setting, cost_benchmark in cost_benchmarks.items():
        summary = cost_benchmark.summaries[0]
        print(f"Cooldown {setting[0]:.0f}s / minimum billing {setting[1]:.0f}s: goodput={100 * summary.completion_slo_rate.mean:.1f}%, worker cost=${summary.estimated_worker_cost.mean:.3f}")
    print(cost_path)


if __name__ == "__main__":
    main()
