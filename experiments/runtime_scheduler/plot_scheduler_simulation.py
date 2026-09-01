from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .scheduler_simulation import POLICY_LABELS, PolicyBenchmarkSummary, SchedulerBenchmark, SchedulerExperimentConfig, SchedulingPolicy, run_scheduler_benchmark


def _plot_metric(axis: plt.Axes, summaries: tuple[PolicyBenchmarkSummary, ...], title: str, ylabel: str, value_name: str) -> None:
    labels = [POLICY_LABELS[summary.policy] for summary in summaries]
    estimates = [getattr(summary, value_name) for summary in summaries]
    values = [estimate.mean for estimate in estimates]
    errors = [estimate.ci95 for estimate in estimates]
    positions = np.arange(len(labels))
    axis.bar(positions, values, yerr=errors, capsize=4, color=["tab:gray", "tab:blue", "tab:orange", "tab:green", "tab:purple"])
    axis.set_xticks(positions, labels, rotation=18, ha="right")
    axis.set_title(title)
    axis.set_ylabel(ylabel)
    axis.grid(axis="y", alpha=0.25)
    for index, value in enumerate(values):
        axis.text(index, value + max(values) * 0.02, f"{value:.2f}", ha="center", va="bottom", fontsize=9)


def build_scheduler_simulation_plot(output_path: Path | None = None, *, config: SchedulerExperimentConfig | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59)) -> tuple[Path, SchedulerBenchmark]:
    selected_config = config or SchedulerExperimentConfig()
    benchmark = run_scheduler_benchmark(selected_config, seeds=seeds)
    figure, axes = plt.subplots(2, 3, figsize=(18, 11), constrained_layout=True)
    summaries = benchmark.summaries
    _plot_metric(axes[0, 0], summaries, "Mean queue wait", "Seconds", "mean_wait_seconds")
    _plot_metric(axes[0, 1], summaries, "P95 queue wait", "Seconds", "p95_wait_seconds")
    _plot_metric(axes[0, 2], summaries, "Mean completion time", "Seconds", "mean_completion_seconds")
    _plot_metric(axes[1, 0], summaries, "Workspace slowdown equality", "Jain index · higher is better", "fairness_index")
    _plot_metric(axes[1, 1], summaries, "Maximum observed queue wait", "Seconds", "maximum_wait_seconds")
    _plot_metric(axes[1, 2], summaries, "Regret versus Oracle-SJF", "Percent", "scheduler_regret_percent")
    figure.suptitle(f"Multi-workspace scheduler benchmark · {selected_config.workspace_count} workspaces · {selected_config.worker_count} workers · {len(seeds)} seeds\nOffered load {benchmark.offered_load_ratio.mean:.2f} · XGBoost prediction MAE {benchmark.prediction_mae_seconds.mean:.2f}s ± {benchmark.prediction_mae_seconds.ci95:.2f}s", fontsize=15)
    destination = output_path or Path(__file__).with_name("scheduler_policy_comparison.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, benchmark


def build_scheduler_stress_plot(output_path: Path | None = None, *, seeds: tuple[int, ...] = (11, 23, 42)) -> tuple[Path, dict[str, SchedulerBenchmark]]:
    base = SchedulerExperimentConfig(tasks_per_workspace=60, training_samples=1_200)
    scenarios = {"Under capacity": replace(base, mean_interarrival_seconds=40.0), "Near capacity": replace(base, mean_interarrival_seconds=25.0), "Overloaded": replace(base, mean_interarrival_seconds=12.0), "Noisy prediction": replace(base, mean_interarrival_seconds=25.0, prediction_noise=0.6), "High cache hit": replace(base, mean_interarrival_seconds=25.0, cache_hit_rate=0.5)}
    benchmarks = {name: run_scheduler_benchmark(config, seeds=seeds) for name, config in scenarios.items()}
    figure, axes = plt.subplots(2, 2, figsize=(17, 10), constrained_layout=True)
    panels = [(axes[0, 0], "Mean queue wait", "Seconds", "mean_wait_seconds"), (axes[0, 1], "P95 queue wait", "Seconds", "p95_wait_seconds"), (axes[1, 0], "Maximum queue wait", "Seconds", "maximum_wait_seconds"), (axes[1, 1], "Regret versus Oracle-SJF", "Percent", "scheduler_regret_percent")]
    positions = np.arange(len(scenarios))
    for axis, title, ylabel, metric_name in panels:
        for policy in SchedulingPolicy:
            values = [getattr(next(summary for summary in benchmark.summaries if summary.policy is policy), metric_name).mean for benchmark in benchmarks.values()]
            axis.plot(positions, values, marker="o", linewidth=1.8, label=POLICY_LABELS[policy])
        axis.set_xticks(positions, list(scenarios), rotation=15, ha="right")
        axis.set_title(title)
        axis.set_ylabel(ylabel)
        axis.grid(axis="y", alpha=0.25)
    axes[0, 0].legend(fontsize=9)
    loads = ", ".join(f"{name}={benchmark.offered_load_ratio.mean:.2f}" for name, benchmark in benchmarks.items())
    figure.suptitle(f"Scheduler stress test · three seeds per scenario\nOffered load: {loads}", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_stress_test.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, benchmarks


def main() -> None:
    path, benchmark = build_scheduler_simulation_plot()
    print(f"Prediction MAE: {benchmark.prediction_mae_seconds.mean:.2f}s ± {benchmark.prediction_mae_seconds.ci95:.2f}s")
    print(f"Prediction RMSE: {benchmark.prediction_rmse_seconds.mean:.2f}s ± {benchmark.prediction_rmse_seconds.ci95:.2f}s")
    print(f"Prediction R²: {benchmark.prediction_r2.mean:.3f} ± {benchmark.prediction_r2.ci95:.3f}")
    print(f"Offered load: {benchmark.offered_load_ratio.mean:.2f} ± {benchmark.offered_load_ratio.ci95:.2f}")
    for summary in benchmark.summaries:
        print(f"{POLICY_LABELS[summary.policy]}: mean wait={summary.mean_wait_seconds.mean:.2f}s, p95 wait={summary.p95_wait_seconds.mean:.2f}s, max wait={summary.maximum_wait_seconds.mean:.2f}s, fairness={summary.fairness_index.mean:.3f}, starvation={summary.starvation_count.mean:.1f}, regret={summary.scheduler_regret_percent.mean:.2f}%")
    print(path)
    stress_path, stress_benchmarks = build_scheduler_stress_plot()
    for name, stress_benchmark in stress_benchmarks.items():
        predicted = next(summary for summary in stress_benchmark.summaries if summary.policy is SchedulingPolicy.FAIR_PREDICTED_SJF)
        aging = next(summary for summary in stress_benchmark.summaries if summary.policy is SchedulingPolicy.FAIR_PREDICTED_SJF_AGING)
        print(f"{name}: load={stress_benchmark.offered_load_ratio.mean:.2f}, predicted mean wait={predicted.mean_wait_seconds.mean:.2f}s, aging mean wait={aging.mean_wait_seconds.mean:.2f}s, predicted max wait={predicted.maximum_wait_seconds.mean:.2f}s, aging max wait={aging.maximum_wait_seconds.mean:.2f}s")
    print(stress_path)


if __name__ == "__main__":
    main()
