from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .retry_checkpoint_simulation import RETRY_LABELS, RetryBenchmark, RetryExperimentConfig, RetryStrategy, RetrySummary, RetryWorkload, generate_retry_workloads, run_retry_benchmark
from .scheduler_simulation import SchedulerExperimentConfig


STRATEGY_COLORS = ("tab:red", "tab:orange", "tab:brown", "tab:blue", "tab:green", "tab:purple")


def _bar_panel(axis: plt.Axes, summaries: tuple[RetrySummary, ...], title: str, ylabel: str, metric_name: str, *, multiplier: float = 1.0, threshold: float | None = None) -> None:
    positions = np.arange(len(summaries))
    values = [getattr(summary, metric_name).mean * multiplier for summary in summaries]
    errors = [getattr(summary, metric_name).ci95 * multiplier for summary in summaries]
    axis.bar(positions, values, yerr=errors, capsize=4, color=STRATEGY_COLORS)
    if threshold is not None:
        axis.axhline(threshold, color="black", linestyle="--", linewidth=1.2, label="Target")
        axis.legend(loc="upper left")
    axis.set_xticks(positions, [RETRY_LABELS[summary.strategy] for summary in summaries], rotation=20, ha="right")
    axis.set_title(title)
    axis.set_ylabel(ylabel)
    axis.grid(axis="y", alpha=0.25)


def build_retry_strategy_comparison_plot(output_path: Path | None = None, *, scheduler_config: SchedulerExperimentConfig | None = None, retry_config: RetryExperimentConfig | None = None, seeds: tuple[int, ...] = (7, 11, 17, 23, 29, 37, 42, 47, 53, 59, 67, 71, 79, 83, 97), workloads: tuple[RetryWorkload, ...] | None = None) -> tuple[Path, RetryBenchmark, tuple[RetryWorkload, ...]]:
    selected_scheduler = scheduler_config or SchedulerExperimentConfig(tasks_per_workspace=50, mean_interarrival_seconds=28.0, training_samples=800)
    selected_retry = retry_config or RetryExperimentConfig(worker_count=selected_scheduler.worker_count, failure_probability=0.2, retry_budget_ratio=0.15)
    selected_workloads = workloads or generate_retry_workloads(selected_scheduler, seeds)
    benchmark = run_retry_benchmark(selected_scheduler, retry_config=selected_retry, seeds=seeds, workloads=selected_workloads)
    summaries = benchmark.summaries
    figure, axes = plt.subplots(2, 3, figsize=(19, 11), constrained_layout=True)
    _bar_panel(axes[0, 0], summaries, "Tasks completed within SLO", "All submitted tasks (%)", "completion_slo_rate", multiplier=100, threshold=95)
    _bar_panel(axes[0, 1], summaries, "Eventually completed tasks", "All submitted tasks (%)", "completion_rate", multiplier=100, threshold=99)
    _bar_panel(axes[0, 2], summaries, "P95 end-to-end completion", "Seconds · lower is better", "p95_end_to_end_seconds", threshold=selected_retry.completion_slo_seconds)
    _bar_panel(axes[1, 0], summaries, "Service-demand amplification", "Executed / original service demand", "demand_amplification", threshold=1.0)
    _bar_panel(axes[1, 1], summaries, "Wasted useful execution", "Worker-seconds", "wasted_useful_seconds")
    _bar_panel(axes[1, 2], summaries, "Estimated fixed-pool worker cost", "USD per workload", "estimated_worker_cost")
    figure.suptitle(f"Retry and checkpoint strategy benchmark · offered load {benchmark.offered_load_ratio.mean:.2f} · {len(seeds)} paired seeds\nIndependent attempt failure {100 * selected_retry.failure_probability:.0f}% · checkpoint every {selected_retry.checkpoint_interval_seconds:.0f}s · retry budget {100 * selected_retry.retry_budget_ratio:.0f}%", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_retry_checkpoint_comparison.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, benchmark, selected_workloads


def build_retry_failure_sensitivity_plot(output_path: Path | None = None, *, scheduler_config: SchedulerExperimentConfig | None = None, retry_config: RetryExperimentConfig | None = None, probabilities: tuple[float, ...] = (0.0, 0.1, 0.2, 0.3, 0.4), seeds: tuple[int, ...] = (7, 11, 17, 23, 29, 37, 42, 47, 53, 59, 67, 71, 79, 83, 97), workloads: tuple[RetryWorkload, ...] | None = None) -> tuple[Path, dict[float, RetryBenchmark]]:
    selected_scheduler = scheduler_config or SchedulerExperimentConfig(tasks_per_workspace=50, mean_interarrival_seconds=28.0, training_samples=800)
    selected_retry = retry_config or RetryExperimentConfig(worker_count=selected_scheduler.worker_count, retry_budget_ratio=0.15)
    selected_workloads = workloads or generate_retry_workloads(selected_scheduler, seeds)
    strategies = (RetryStrategy.RESTART_IMMEDIATE, RetryStrategy.RESTART_BACKOFF_BUDGET, RetryStrategy.CHECKPOINT_IMMEDIATE, RetryStrategy.CHECKPOINT_BACKOFF_BUDGET)
    benchmarks = {probability: run_retry_benchmark(selected_scheduler, retry_config=replace(selected_retry, failure_probability=probability), strategies=strategies, seeds=seeds, workloads=selected_workloads) for probability in probabilities}
    figure, axes = plt.subplots(2, 2, figsize=(16, 10), constrained_layout=True)
    panels = ((axes[0, 0], "Tasks completed within SLO", "All submitted tasks (%)", "completion_slo_rate", 100.0), (axes[0, 1], "P95 end-to-end completion", "Seconds", "p95_end_to_end_seconds", 1.0), (axes[1, 0], "Service-demand amplification", "Executed / original demand", "demand_amplification", 1.0), (axes[1, 1], "Eventually failed tasks", "All submitted tasks (%)", "failed_rate", 100.0))
    for axis, title, ylabel, metric_name, multiplier in panels:
        for strategy_index, strategy in enumerate(strategies):
            values = [getattr(next(summary for summary in benchmark.summaries if summary.strategy is strategy), metric_name).mean * multiplier for benchmark in benchmarks.values()]
            axis.plot([100 * probability for probability in probabilities], values, marker="o", linewidth=2, color=STRATEGY_COLORS[strategy_index + 1], label=RETRY_LABELS[strategy])
        axis.set_title(title)
        axis.set_xlabel("Independent attempt failure probability (%)")
        axis.set_ylabel(ylabel)
        axis.grid(alpha=0.25)
    axes[0, 0].axhline(95, color="black", linestyle="--", linewidth=1.2, label="Goodput target")
    axes[0, 1].axhline(selected_retry.completion_slo_seconds, color="black", linestyle="--", linewidth=1.2, label="Completion SLO")
    axes[0, 0].legend(fontsize=8)
    axes[0, 1].legend(fontsize=8)
    figure.suptitle(f"Retry failure-rate sensitivity · offered load {next(iter(benchmarks.values())).offered_load_ratio.mean:.2f} · {len(seeds)} paired seeds", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_retry_failure_sensitivity.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, benchmarks


def build_checkpoint_interval_sensitivity_plot(output_path: Path | None = None, *, scheduler_config: SchedulerExperimentConfig | None = None, retry_config: RetryExperimentConfig | None = None, intervals: tuple[float, ...] = (10.0, 20.0, 30.0, 60.0, 120.0), seeds: tuple[int, ...] = (7, 11, 17, 23, 29, 37, 42, 47, 53, 59, 67, 71, 79, 83, 97), workloads: tuple[RetryWorkload, ...] | None = None) -> tuple[Path, dict[float, RetryBenchmark]]:
    selected_scheduler = scheduler_config or SchedulerExperimentConfig(tasks_per_workspace=50, mean_interarrival_seconds=28.0, training_samples=800)
    selected_retry = retry_config or RetryExperimentConfig(worker_count=selected_scheduler.worker_count, failure_probability=0.2)
    selected_workloads = workloads or generate_retry_workloads(selected_scheduler, seeds)
    strategy = tuple([RetryStrategy.CHECKPOINT_IMMEDIATE])
    benchmarks = {interval: run_retry_benchmark(selected_scheduler, retry_config=replace(selected_retry, checkpoint_interval_seconds=interval), strategies=strategy, seeds=seeds, workloads=selected_workloads) for interval in intervals}
    figure, axes = plt.subplots(2, 2, figsize=(16, 10), constrained_layout=True)
    panels = ((axes[0, 0], "Tasks completed within SLO", "All submitted tasks (%)", "completion_slo_rate", 100.0), (axes[0, 1], "Service-demand amplification", "Executed / original demand", "demand_amplification", 1.0), (axes[1, 0], "Checkpoint overhead", "Worker-seconds", "checkpoint_overhead_seconds", 1.0), (axes[1, 1], "Estimated fixed-pool worker cost", "USD per workload", "estimated_worker_cost", 1.0))
    for axis, title, ylabel, metric_name, multiplier in panels:
        values = [getattr(benchmark.summaries[0], metric_name).mean * multiplier for benchmark in benchmarks.values()]
        axis.plot(intervals, values, marker="o", linewidth=2, color=STRATEGY_COLORS[3])
        axis.set_title(title)
        axis.set_ylabel(ylabel)
        axis.grid(alpha=0.25)
    for axis in axes[0]:
        axis.tick_params(labelbottom=False)
    for axis in axes[1]:
        axis.set_xlabel("Checkpoint interval (seconds)")
    axes[0, 0].axhline(95, color="black", linestyle="--", linewidth=1.2, label="Goodput target")
    axes[0, 0].legend()
    figure.suptitle(f"Checkpoint interval sensitivity · failure {100 * selected_retry.failure_probability:.0f}% · overhead {selected_retry.checkpoint_overhead_seconds:.1f}s\nOffered load {next(iter(benchmarks.values())).offered_load_ratio.mean:.2f} · {len(seeds)} paired seeds", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_checkpoint_interval_sensitivity.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, benchmarks


def build_retry_outage_comparison_plot(output_path: Path | None = None, *, scheduler_config: SchedulerExperimentConfig | None = None, retry_config: RetryExperimentConfig | None = None, seeds: tuple[int, ...] = (7, 11, 17, 23, 29, 37, 42, 47, 53, 59, 67, 71, 79, 83, 97), workloads: tuple[RetryWorkload, ...] | None = None) -> tuple[Path, RetryBenchmark]:
    selected_scheduler = scheduler_config or SchedulerExperimentConfig(tasks_per_workspace=50, mean_interarrival_seconds=28.0, training_samples=800)
    selected_retry = retry_config or RetryExperimentConfig(worker_count=selected_scheduler.worker_count, failure_probability=0.05, retry_budget_ratio=0.15, base_backoff_seconds=60.0, maximum_backoff_seconds=240.0, jitter_ratio=0.5, outage_at_seconds=500.0, outage_duration_seconds=60.0)
    selected_workloads = workloads or generate_retry_workloads(selected_scheduler, seeds)
    benchmark = run_retry_benchmark(selected_scheduler, retry_config=selected_retry, seeds=seeds, workloads=selected_workloads)
    summaries = benchmark.summaries
    figure, axes = plt.subplots(2, 3, figsize=(19, 11), constrained_layout=True)
    _bar_panel(axes[0, 0], summaries, "Retry releases within 10 seconds", "Retry count · lower is better", "peak_retry_release_count")
    _bar_panel(axes[0, 1], summaries, "Peak ready queue", "Tasks", "peak_ready_queue")
    _bar_panel(axes[0, 2], summaries, "Recovery after arrivals and outage", "Seconds", "recovery_after_disturbance_seconds")
    _bar_panel(axes[1, 0], summaries, "Tasks completed within SLO", "All submitted tasks (%)", "completion_slo_rate", multiplier=100, threshold=95)
    _bar_panel(axes[1, 1], summaries, "P95 end-to-end completion", "Seconds", "p95_end_to_end_seconds", threshold=selected_retry.completion_slo_seconds)
    _bar_panel(axes[1, 2], summaries, "Service-demand amplification", "Executed / original demand", "demand_amplification", threshold=1.0)
    figure.suptitle(f"Correlated provider outage and retry storm · outage {selected_retry.outage_duration_seconds:.0f}s · {len(seeds)} paired seeds\nIndependent failure {100 * selected_retry.failure_probability:.0f}% · backoff base {selected_retry.base_backoff_seconds:.0f}s · jitter {100 * selected_retry.jitter_ratio:.0f}%", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_retry_outage_comparison.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, benchmark


def main() -> None:
    comparison_path, benchmark, workloads = build_retry_strategy_comparison_plot()
    print(f"Offered load: {benchmark.offered_load_ratio.mean:.2f}")
    for summary in benchmark.summaries:
        print(f"{RETRY_LABELS[summary.strategy]}: completed={100 * summary.completion_rate.mean:.1f}%, SLO goodput={100 * summary.completion_slo_rate.mean:.1f}%, p95={summary.p95_end_to_end_seconds.mean:.1f}s, demand amp={summary.demand_amplification.mean:.3f}, wasted={summary.wasted_useful_seconds.mean:.1f}s, cost=${summary.estimated_worker_cost.mean:.3f}")
    print(comparison_path)
    failure_path, failure_benchmarks = build_retry_failure_sensitivity_plot(workloads=workloads)
    for probability, failure_benchmark in failure_benchmarks.items():
        restart = next(summary for summary in failure_benchmark.summaries if summary.strategy is RetryStrategy.RESTART_IMMEDIATE)
        checkpoint = next(summary for summary in failure_benchmark.summaries if summary.strategy is RetryStrategy.CHECKPOINT_IMMEDIATE)
        print(f"Failure {100 * probability:.0f}%: restart goodput={100 * restart.completion_slo_rate.mean:.1f}%, restart amp={restart.demand_amplification.mean:.3f}, checkpoint goodput={100 * checkpoint.completion_slo_rate.mean:.1f}%, checkpoint amp={checkpoint.demand_amplification.mean:.3f}")
    print(failure_path)
    interval_path, interval_benchmarks = build_checkpoint_interval_sensitivity_plot(workloads=workloads)
    for interval, interval_benchmark in interval_benchmarks.items():
        summary = interval_benchmark.summaries[0]
        print(f"Checkpoint {interval:.0f}s: goodput={100 * summary.completion_slo_rate.mean:.1f}%, demand amp={summary.demand_amplification.mean:.3f}, overhead={summary.checkpoint_overhead_seconds.mean:.1f}s, cost=${summary.estimated_worker_cost.mean:.3f}")
    print(interval_path)
    outage_path, outage_benchmark = build_retry_outage_comparison_plot(workloads=workloads)
    for summary in outage_benchmark.summaries:
        print(f"Outage {RETRY_LABELS[summary.strategy]}: burst={summary.peak_retry_release_count.mean:.1f}, peak queue={summary.peak_ready_queue.mean:.1f}, recovery={summary.recovery_after_disturbance_seconds.mean:.1f}s, goodput={100 * summary.completion_slo_rate.mean:.1f}%")
    print(outage_path)


if __name__ == "__main__":
    main()
