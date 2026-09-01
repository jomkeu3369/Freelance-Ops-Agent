from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .overload_simulation import ADMISSION_LABELS, AdmissionBenchmark, AdmissionBenchmarkSummary, AdmissionConfig, AdmissionPolicy, run_admission_benchmark
from .scheduler_simulation import SchedulerExperimentConfig, SchedulingPolicy


POLICY_COLORS = ("tab:gray", "tab:blue", "tab:orange", "tab:green")


def _bar_panel(axis: plt.Axes, summaries: tuple[AdmissionBenchmarkSummary, ...], title: str, ylabel: str, metric_name: str, *, percent: bool = False, threshold: float | None = None) -> None:
    multiplier = 100 if percent else 1
    values = [getattr(summary, metric_name).mean * multiplier for summary in summaries]
    errors = [getattr(summary, metric_name).ci95 * multiplier for summary in summaries]
    positions = np.arange(len(summaries))
    axis.bar(positions, values, yerr=errors, capsize=4, color=POLICY_COLORS)
    if threshold is not None:
        axis.axhline(threshold * multiplier, color="black", linestyle="--", linewidth=1.2, label="Target")
        axis.legend(loc="upper left")
    axis.set_xticks(positions, [ADMISSION_LABELS[summary.policy] for summary in summaries], rotation=18, ha="right")
    axis.set_title(title)
    axis.set_ylabel(ylabel)
    axis.grid(axis="y", alpha=0.25)


def build_overload_admission_plot(output_path: Path | None = None, *, config: SchedulerExperimentConfig | None = None, admission_config: AdmissionConfig | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59)) -> tuple[Path, AdmissionBenchmark]:
    selected_config = config or SchedulerExperimentConfig(tasks_per_workspace=80, mean_interarrival_seconds=12.0, training_samples=2_000)
    selected_admission = admission_config or AdmissionConfig()
    benchmark = run_admission_benchmark(selected_config, admission_config=selected_admission, scheduler_policy=SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING, seeds=seeds)
    summaries = benchmark.summaries
    labels = [ADMISSION_LABELS[summary.policy] for summary in summaries]
    positions = np.arange(len(labels))
    figure, axes = plt.subplots(2, 3, figsize=(18, 11), constrained_layout=True)
    admitted = [100 * summary.admitted_rate.mean for summary in summaries]
    deferred = [100 * summary.deferred_rate.mean for summary in summaries]
    rejected = [100 * summary.rejected_rate.mean for summary in summaries]
    axes[0, 0].bar(positions, [value - deferred[index] for index, value in enumerate(admitted)], color="tab:blue", label="Immediate admit")
    axes[0, 0].bar(positions, deferred, bottom=[value - deferred[index] for index, value in enumerate(admitted)], color="tab:orange", label="Deferred")
    axes[0, 0].bar(positions, rejected, bottom=admitted, color="tab:red", label="Rejected")
    axes[0, 0].set_xticks(positions, labels, rotation=18, ha="right")
    axes[0, 0].set_title("Admission decisions")
    axes[0, 0].set_ylabel("Tasks (%)")
    axes[0, 0].legend(loc="upper right")
    axes[0, 0].grid(axis="y", alpha=0.25)
    _bar_panel(axes[0, 1], summaries, "P95 end-to-end completion", "Seconds · lower is better", "p95_end_to_end_seconds", threshold=selected_admission.completion_slo_seconds)
    _bar_panel(axes[0, 2], summaries, "P99 end-to-end completion", "Seconds · lower is better", "p99_end_to_end_seconds", threshold=selected_admission.completion_slo_seconds)
    _bar_panel(axes[1, 0], summaries, "Tasks completed within SLO", "All submitted tasks (%)", "completion_slo_rate", percent=True, threshold=0.95)
    high_values = [100 * summary.high_priority_acceptance_rate.mean for summary in summaries]
    low_values = [100 * summary.low_priority_acceptance_rate.mean for summary in summaries]
    width = 0.36
    axes[1, 1].bar(positions - width / 2, high_values, width, color="tab:green", label="Priority 4-5")
    axes[1, 1].bar(positions + width / 2, low_values, width, color="tab:gray", label="Priority 1-2")
    axes[1, 1].set_xticks(positions, labels, rotation=18, ha="right")
    axes[1, 1].set_title("Acceptance by priority")
    axes[1, 1].set_ylabel("Accepted tasks (%)")
    axes[1, 1].legend(loc="lower left")
    axes[1, 1].grid(axis="y", alpha=0.25)
    _bar_panel(axes[1, 2], summaries, "Recovery after final arrival", "Seconds · lower is better", "recovery_after_last_arrival_seconds")
    figure.suptitle(f"Overload admission benchmark · load {benchmark.offered_load_ratio.mean:.2f} · Global Predicted-SJF + Aging · {len(seeds)} paired seeds\nDrain target {selected_admission.max_active_drain_seconds:.0f}s · max defer {selected_admission.max_defer_seconds:.0f}s · completion SLO {selected_admission.completion_slo_seconds:.0f}s", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_overload_admission.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, benchmark


def build_admission_load_curve_plot(output_path: Path | None = None, *, admission_config: AdmissionConfig | None = None, seeds: tuple[int, ...] = (11, 23, 42)) -> tuple[Path, dict[str, AdmissionBenchmark]]:
    selected_admission = admission_config or AdmissionConfig()
    base = SchedulerExperimentConfig(tasks_per_workspace=60, training_samples=1_200)
    scenarios = {"Under capacity": replace(base, mean_interarrival_seconds=40.0), "Near capacity": replace(base, mean_interarrival_seconds=25.0), "Overloaded": replace(base, mean_interarrival_seconds=12.0), "Severe overload": replace(base, mean_interarrival_seconds=7.0)}
    benchmarks = {name: run_admission_benchmark(config, admission_config=selected_admission, scheduler_policy=SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING, seeds=seeds) for name, config in scenarios.items()}
    loads = [benchmark.offered_load_ratio.mean for benchmark in benchmarks.values()]
    figure, axes = plt.subplots(2, 2, figsize=(16, 10), constrained_layout=True)
    panels = ((axes[0, 0], "P95 end-to-end completion", "Seconds", "p95_end_to_end_seconds", 1), (axes[0, 1], "Tasks completed within SLO", "All submitted tasks (%)", "completion_slo_rate", 100), (axes[1, 0], "Rejected tasks", "Submitted tasks (%)", "rejected_rate", 100), (axes[1, 1], "Recovery after final arrival", "Seconds", "recovery_after_last_arrival_seconds", 1))
    for axis, title, ylabel, metric_name, multiplier in panels:
        for policy_index, policy in enumerate(AdmissionPolicy):
            values = [getattr(next(summary for summary in benchmark.summaries if summary.policy is policy), metric_name).mean * multiplier for benchmark in benchmarks.values()]
            axis.plot(loads, values, marker="o", linewidth=2, color=POLICY_COLORS[policy_index], label=ADMISSION_LABELS[policy])
        axis.axvline(1.0, color="black", linestyle="--", linewidth=1.2, label="Capacity boundary" if axis is axes[0, 0] else None)
        axis.set_title(title)
        axis.set_xlabel("Offered load ratio")
        axis.set_ylabel(ylabel)
        axis.grid(alpha=0.25)
    axes[0, 0].legend(fontsize=9)
    figure.suptitle(f"Admission robustness by offered load · three paired seeds\nGlobal Predicted-SJF + Aging · completion SLO {selected_admission.completion_slo_seconds:.0f}s", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_admission_load_curve.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, benchmarks


def main() -> None:
    plot_path, benchmark = build_overload_admission_plot()
    print(f"Offered load: {benchmark.offered_load_ratio.mean:.2f}")
    for summary in benchmark.summaries:
        print(f"{ADMISSION_LABELS[summary.policy]}: admitted={100 * summary.admitted_rate.mean:.1f}%, deferred={100 * summary.deferred_rate.mean:.1f}%, rejected={100 * summary.rejected_rate.mean:.1f}%, p95={summary.p95_end_to_end_seconds.mean:.1f}s, p99={summary.p99_end_to_end_seconds.mean:.1f}s, SLO goodput={100 * summary.completion_slo_rate.mean:.1f}%, high priority accepted={100 * summary.high_priority_acceptance_rate.mean:.1f}%, recovery={summary.recovery_after_last_arrival_seconds.mean:.1f}s")
    print(plot_path)
    load_path, benchmarks = build_admission_load_curve_plot()
    for name, scenario in benchmarks.items():
        hybrid = next(summary for summary in scenario.summaries if summary.policy is AdmissionPolicy.HYBRID_GUARD)
        print(f"{name}: load={scenario.offered_load_ratio.mean:.2f}, hybrid rejected={100 * hybrid.rejected_rate.mean:.1f}%, hybrid SLO goodput={100 * hybrid.completion_slo_rate.mean:.1f}%, hybrid recovery={hybrid.recovery_after_last_arrival_seconds.mean:.1f}s")
    print(load_path)


if __name__ == "__main__":
    main()
