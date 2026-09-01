from __future__ import annotations

from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .autoscaling_simulation import AUTOSCALING_LABELS, AutoscalingBenchmark, AutoscalingConfig, AutoscalingStrategy, AutoscalingSummary, run_autoscaling_benchmark
from .overload_simulation import AdmissionConfig
from .scheduler_simulation import SchedulerExperimentConfig


STRATEGY_COLORS = ("tab:gray", "tab:orange", "tab:blue", "tab:green", "tab:purple")


def _bar_panel(axis: plt.Axes, summaries: tuple[AutoscalingSummary, ...], title: str, ylabel: str, metric_name: str, *, multiplier: float = 1.0, threshold: float | None = None) -> None:
    positions = np.arange(len(summaries))
    values = [getattr(summary, metric_name).mean * multiplier for summary in summaries]
    errors = [getattr(summary, metric_name).ci95 * multiplier for summary in summaries]
    axis.bar(positions, values, yerr=errors, capsize=4, color=STRATEGY_COLORS)
    if threshold is not None:
        axis.axhline(threshold, color="black", linestyle="--", linewidth=1.2, label="Target")
        axis.legend(loc="upper left")
    axis.set_xticks(positions, [AUTOSCALING_LABELS[summary.strategy] for summary in summaries], rotation=20, ha="right")
    axis.set_title(title)
    axis.set_ylabel(ylabel)
    axis.grid(axis="y", alpha=0.25)


def build_autoscaling_comparison_plot(output_path: Path | None = None, *, config: SchedulerExperimentConfig | None = None, admission_config: AdmissionConfig | None = None, autoscaling_config: AutoscalingConfig | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59)) -> tuple[Path, AutoscalingBenchmark]:
    selected_config = config or SchedulerExperimentConfig(tasks_per_workspace=80, mean_interarrival_seconds=12.0, training_samples=2_000)
    selected_admission = admission_config or AdmissionConfig()
    selected_autoscaling = autoscaling_config or AutoscalingConfig()
    benchmark = run_autoscaling_benchmark(selected_config, admission_config=selected_admission, autoscaling_config=selected_autoscaling, seeds=seeds)
    summaries = benchmark.summaries
    figure, axes = plt.subplots(2, 3, figsize=(19, 11), constrained_layout=True)
    _bar_panel(axes[0, 0], summaries, "P95 end-to-end completion", "Seconds · lower is better", "p95_end_to_end_seconds", threshold=selected_admission.completion_slo_seconds)
    _bar_panel(axes[0, 1], summaries, "Tasks completed within SLO", "All submitted tasks (%)", "completion_slo_rate", multiplier=100, threshold=95)
    _bar_panel(axes[0, 2], summaries, "Rejected tasks", "Submitted tasks (%)", "rejected_rate", multiplier=100)
    _bar_panel(axes[1, 0], summaries, "Priority 4-5 acceptance", "High-priority tasks (%)", "high_priority_acceptance_rate", multiplier=100, threshold=99)
    _bar_panel(axes[1, 1], summaries, "Recovery after final arrival", "Seconds · lower is better", "recovery_after_last_arrival_seconds")
    _bar_panel(axes[1, 2], summaries, "SLO goodput efficiency", "SLO tasks per 1,000 worker-sec", "slo_tasks_per_1000_worker_seconds")
    figure.suptitle(f"Autoscaling strategy benchmark · offered load {benchmark.offered_load_ratio.mean:.2f} · {len(seeds)} paired seeds\nBase workers {selected_config.worker_count} · scale factor {selected_autoscaling.scale_factor:.1f} · scale-up delay {selected_autoscaling.scale_up_delay_seconds:.0f}s", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_autoscaling_comparison.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, benchmark


def build_scale_delay_sensitivity_plot(output_path: Path | None = None, *, config: SchedulerExperimentConfig | None = None, admission_config: AdmissionConfig | None = None, delays: tuple[float, ...] = (0.0, 30.0, 60.0, 120.0, 240.0), seeds: tuple[int, ...] = (11, 23, 42)) -> tuple[Path, dict[float, AutoscalingBenchmark]]:
    selected_config = config or SchedulerExperimentConfig(tasks_per_workspace=60, mean_interarrival_seconds=12.0, training_samples=1_200)
    selected_admission = admission_config or AdmissionConfig()
    strategies = (AutoscalingStrategy.REACTIVE_SCALE, AutoscalingStrategy.SHED_THEN_SCALE)
    benchmarks = {delay: run_autoscaling_benchmark(selected_config, admission_config=selected_admission, autoscaling_config=AutoscalingConfig(scale_up_delay_seconds=delay), strategies=strategies, seeds=seeds) for delay in delays}
    figure, axes = plt.subplots(2, 2, figsize=(16, 10), constrained_layout=True)
    panels = ((axes[0, 0], "P95 end-to-end completion", "Seconds", "p95_end_to_end_seconds", 1.0), (axes[0, 1], "Tasks completed within SLO", "All submitted tasks (%)", "completion_slo_rate", 100.0), (axes[1, 0], "Recovery after final arrival", "Seconds", "recovery_after_last_arrival_seconds", 1.0), (axes[1, 1], "SLO goodput efficiency", "SLO tasks per 1,000 worker-sec", "slo_tasks_per_1000_worker_seconds", 1.0))
    for axis, title, ylabel, metric_name, multiplier in panels:
        for strategy_index, strategy in enumerate(strategies):
            values = [getattr(next(summary for summary in benchmark.summaries if summary.strategy is strategy), metric_name).mean * multiplier for benchmark in benchmarks.values()]
            axis.plot(delays, values, marker="o", linewidth=2, color=STRATEGY_COLORS[strategy_index + 2], label=AUTOSCALING_LABELS[strategy])
        axis.set_title(title)
        axis.set_xlabel("Scale-up delay (seconds)")
        axis.set_ylabel(ylabel)
        axis.grid(alpha=0.25)
    axes[0, 0].axhline(selected_admission.completion_slo_seconds, color="black", linestyle="--", linewidth=1.2, label="Completion SLO")
    axes[0, 1].axhline(95, color="black", linestyle="--", linewidth=1.2, label="Goodput target")
    axes[0, 0].legend(fontsize=9)
    axes[0, 1].legend(fontsize=9)
    figure.suptitle(f"Scale-up delay sensitivity · offered load {next(iter(benchmarks.values())).offered_load_ratio.mean:.2f} · three paired seeds\nBase workers {selected_config.worker_count} · scale factor 2.0", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_scale_delay_sensitivity.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, benchmarks


def main() -> None:
    comparison_path, benchmark = build_autoscaling_comparison_plot()
    print(f"Offered load: {benchmark.offered_load_ratio.mean:.2f}")
    for summary in benchmark.summaries:
        print(f"{AUTOSCALING_LABELS[summary.strategy]}: rejected={100 * summary.rejected_rate.mean:.1f}%, p95={summary.p95_end_to_end_seconds.mean:.1f}s, SLO goodput={100 * summary.completion_slo_rate.mean:.1f}%, high priority accepted={100 * summary.high_priority_acceptance_rate.mean:.1f}%, recovery={summary.recovery_after_last_arrival_seconds.mean:.1f}s, efficiency={summary.slo_tasks_per_1000_worker_seconds.mean:.2f}")
    print(comparison_path)
    sensitivity_path, benchmarks = build_scale_delay_sensitivity_plot()
    for delay, delay_benchmark in benchmarks.items():
        reactive = next(summary for summary in delay_benchmark.summaries if summary.strategy is AutoscalingStrategy.REACTIVE_SCALE)
        shed = next(summary for summary in delay_benchmark.summaries if summary.strategy is AutoscalingStrategy.SHED_THEN_SCALE)
        print(f"Delay {delay:.0f}s: reactive goodput={100 * reactive.completion_slo_rate.mean:.1f}%, reactive p95={reactive.p95_end_to_end_seconds.mean:.1f}s, shed goodput={100 * shed.completion_slo_rate.mean:.1f}%, shed p95={shed.p95_end_to_end_seconds.mean:.1f}s")
    print(sensitivity_path)


if __name__ == "__main__":
    main()
