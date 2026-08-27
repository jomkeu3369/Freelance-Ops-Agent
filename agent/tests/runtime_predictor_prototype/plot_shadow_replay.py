from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

from .scheduler_simulation import MetricEstimate, SchedulerExperimentConfig, SchedulingPolicy, _estimate, generate_scheduler_workload, simulate_scheduler
from .shadow_replay import SHADOW_REPLAY_SCHEMA_VERSION, ReplayMetrics, ReplaySource, ShadowTaskAttempt, run_shadow_replay


@dataclass(frozen=True, slots=True)
class ShadowReplayPlotSummary:
    name: str
    source: ReplaySource
    mean_wait_seconds: MetricEstimate
    p95_wait_seconds: MetricEstimate
    maximum_wait_seconds: MetricEstimate
    mean_completion_seconds: MetricEstimate
    completion_slo_rate: MetricEstimate
    fairness_index: MetricEstimate


@dataclass(frozen=True, slots=True)
class ShadowReplayPlotBenchmark:
    summaries: tuple[ShadowReplayPlotSummary, ...]
    offered_load_ratio: MetricEstimate
    maximum_fifo_replay_delta: float
    record_count: int
    seed_count: int


def _fixture_records(config: SchedulerExperimentConfig, seed: int) -> tuple[tuple[ShadowTaskAttempt, ...], float]:
    tasks, prediction_metrics = generate_scheduler_workload(config, random_seed=seed)
    observed = simulate_scheduler(tasks, SchedulingPolicy.FIFO, worker_count=config.worker_count)
    original_by_id = {task.task_id: task for task in tasks}
    anchor = datetime(2026, 8, 27, tzinfo=UTC) + timedelta(days=seed)
    records: list[ShadowTaskAttempt] = []
    for result in observed.task_results:
        original = original_by_id[result.task_id]
        queued_at = anchor + timedelta(seconds=result.queued_at_seconds)
        records.append(ShadowTaskAttempt(schema_version=SHADOW_REPLAY_SCHEMA_VERSION, attempt_id=result.task_id, task_id=result.task_id, attempt_number=1, workspace_id=result.workspace_id, task_type="fixture_task", model="fixture_model", input_tokens=1_000, context_tokens=2_000, file_count=1, subagent_depth=1, priority=result.priority, queued_at=queued_at, started_at=anchor + timedelta(seconds=result.started_at_seconds), completed_at=anchor + timedelta(seconds=result.completed_at_seconds), feature_snapshot_at=queued_at, predicted_at=queued_at, predicted_runtime_seconds=result.predicted_runtime_seconds, predictor_version="fixture-predictor-v1", runtime_seconds=result.actual_runtime_seconds, success=True, cache_hit=result.cache_hit, workspace_weight=original.workspace_weight, metadata={"fixture_only": True}))
    return tuple(records), prediction_metrics[3]


def _summarize_metric(rows: list[tuple[str, ReplaySource, ReplayMetrics]], name: str, source: ReplaySource) -> ShadowReplayPlotSummary:
    selected = [metrics for row_name, row_source, metrics in rows if row_name == name and row_source is source]
    return ShadowReplayPlotSummary(name=name, source=source, mean_wait_seconds=_estimate([metrics.mean_wait_seconds for metrics in selected]), p95_wait_seconds=_estimate([metrics.p95_wait_seconds for metrics in selected]), maximum_wait_seconds=_estimate([metrics.maximum_wait_seconds for metrics in selected]), mean_completion_seconds=_estimate([metrics.mean_completion_seconds for metrics in selected]), completion_slo_rate=_estimate([metrics.completion_slo_rate for metrics in selected]), fairness_index=_estimate([metrics.fairness_index for metrics in selected]))


def _bar_panel(axis: plt.Axes, summaries: tuple[ShadowReplayPlotSummary, ...], title: str, ylabel: str, metric_name: str, *, multiplier: float = 1.0, threshold: float | None = None) -> None:
    positions = np.arange(len(summaries))
    values = [getattr(summary, metric_name).mean * multiplier for summary in summaries]
    errors = [getattr(summary, metric_name).ci95 * multiplier for summary in summaries]
    colors = ["tab:gray", "tab:blue", "tab:orange", "tab:green", "tab:purple"]
    axis.bar(positions, values, yerr=errors, capsize=4, color=colors)
    if threshold is not None:
        axis.axhline(threshold, color="black", linestyle="--", linewidth=1.2, label="Target")
        axis.legend(loc="upper left")
    axis.set_xticks(positions, [summary.name for summary in summaries], rotation=20, ha="right")
    axis.set_title(title)
    axis.set_ylabel(ylabel)
    axis.grid(axis="y", alpha=0.25)


def build_shadow_replay_validation_plot(output_path: Path | None = None, *, config: SchedulerExperimentConfig | None = None, seeds: tuple[int, ...] = (11, 23, 37, 42, 59), completion_slo_seconds: float = 300.0) -> tuple[Path, ShadowReplayPlotBenchmark]:
    selected_config = config or SchedulerExperimentConfig(tasks_per_workspace=50, mean_interarrival_seconds=25.0, training_samples=800)
    policies = (SchedulingPolicy.FIFO, SchedulingPolicy.GLOBAL_PREDICTED_SJF, SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING, SchedulingPolicy.FAIR_PREDICTED_SJF_AGING)
    rows: list[tuple[str, ReplaySource, ReplayMetrics]] = []
    loads: list[float] = []
    fifo_deltas: list[float] = []
    record_count = 0
    display_names = {"Observed production order": "Observed FIFO", SchedulingPolicy.FIFO.value: "Replay FIFO", SchedulingPolicy.GLOBAL_PREDICTED_SJF.value: "Global Predicted-SJF", SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING.value: "Predicted-SJF + Aging", SchedulingPolicy.FAIR_PREDICTED_SJF_AGING.value: "Fair PSJF + Aging"}
    for seed in seeds:
        records, load = _fixture_records(selected_config, seed)
        replay = run_shadow_replay(records, worker_count=selected_config.worker_count, completion_slo_seconds=completion_slo_seconds, policies=policies, max_wait_seconds=selected_config.max_wait_seconds, aging_rate=selected_config.aging_rate, aging_overdue_interval=selected_config.aging_overdue_interval)
        record_count += len(records)
        loads.append(load)
        for result in replay.results:
            rows.append((display_names[result.name], result.source, result.metrics))
        observed_metrics = replay.results[0].metrics
        fifo_metrics = replay.results[1].metrics
        fifo_deltas.extend((abs(observed_metrics.mean_wait_seconds - fifo_metrics.mean_wait_seconds), abs(observed_metrics.p95_wait_seconds - fifo_metrics.p95_wait_seconds), abs(observed_metrics.mean_completion_seconds - fifo_metrics.mean_completion_seconds)))
    ordered_keys = (("Observed FIFO", ReplaySource.OBSERVED), ("Replay FIFO", ReplaySource.COUNTERFACTUAL), ("Global Predicted-SJF", ReplaySource.COUNTERFACTUAL), ("Predicted-SJF + Aging", ReplaySource.COUNTERFACTUAL), ("Fair PSJF + Aging", ReplaySource.COUNTERFACTUAL))
    summaries = tuple(_summarize_metric(rows, name, source) for name, source in ordered_keys)
    benchmark = ShadowReplayPlotBenchmark(summaries=summaries, offered_load_ratio=_estimate(loads), maximum_fifo_replay_delta=max(fifo_deltas), record_count=record_count, seed_count=len(seeds))
    figure, axes = plt.subplots(2, 3, figsize=(19, 11), constrained_layout=True)
    _bar_panel(axes[0, 0], summaries, "Mean queue wait", "Seconds · lower is better", "mean_wait_seconds")
    _bar_panel(axes[0, 1], summaries, "P95 queue wait", "Seconds · lower is better", "p95_wait_seconds")
    _bar_panel(axes[0, 2], summaries, "Maximum queue wait", "Seconds · lower is better", "maximum_wait_seconds", threshold=selected_config.max_wait_seconds)
    _bar_panel(axes[1, 0], summaries, "Mean completion", "Seconds · lower is better", "mean_completion_seconds")
    _bar_panel(axes[1, 1], summaries, "Tasks completed within SLO", "Successful tasks (%)", "completion_slo_rate", multiplier=100, threshold=95)
    _bar_panel(axes[1, 2], summaries, "Workspace fairness", "Jain index · higher is better", "fairness_index", threshold=0.9)
    figure.suptitle(f"Shadow replay pipeline validation fixture · offered load {benchmark.offered_load_ratio.mean:.2f} · {benchmark.seed_count} paired seeds\nSynthetic fixture only · Observed FIFO versus exact FIFO replay delta {benchmark.maximum_fifo_replay_delta:.6f}s", fontsize=14)
    destination = output_path or Path(__file__).with_name("scheduler_shadow_replay_pipeline_validation.png")
    figure.savefig(destination, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return destination, benchmark


def main() -> None:
    path, benchmark = build_shadow_replay_validation_plot()
    print(f"Fixture records: {benchmark.record_count}")
    print(f"Offered load: {benchmark.offered_load_ratio.mean:.2f}")
    print(f"Maximum observed FIFO versus replay FIFO delta: {benchmark.maximum_fifo_replay_delta:.9f}s")
    for summary in benchmark.summaries:
        print(f"{summary.name}: mean wait={summary.mean_wait_seconds.mean:.1f}s, p95 wait={summary.p95_wait_seconds.mean:.1f}s, max wait={summary.maximum_wait_seconds.mean:.1f}s, mean completion={summary.mean_completion_seconds.mean:.1f}s, SLO={100 * summary.completion_slo_rate.mean:.1f}%, fairness={summary.fairness_index.mean:.3f}")
    print(path)


if __name__ == "__main__":
    main()
