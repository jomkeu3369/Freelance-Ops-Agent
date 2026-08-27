from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum

from .overload_simulation import AdmissionConfig, AdmissionPolicy, AdmissionRunMetrics, simulate_admission_policy
from .scheduler_simulation import MetricEstimate, SchedulerExperimentConfig, SchedulerTask, SchedulingPolicy, WorkerCapacityEvent, _estimate, generate_scheduler_workload


class AutoscalingStrategy(StrEnum):
    STATIC_ACCEPT_ALL = "static_accept_all"
    STATIC_PRIORITY_SHED = "static_priority_shed"
    REACTIVE_SCALE = "reactive_scale"
    SHED_THEN_SCALE = "shed_then_scale"
    PREDICTIVE_SCALE = "predictive_scale"


AUTOSCALING_LABELS = {AutoscalingStrategy.STATIC_ACCEPT_ALL: "Static accept all", AutoscalingStrategy.STATIC_PRIORITY_SHED: "Static priority shed", AutoscalingStrategy.REACTIVE_SCALE: "Reactive scale", AutoscalingStrategy.SHED_THEN_SCALE: "Shed then scale", AutoscalingStrategy.PREDICTIVE_SCALE: "Predictive scale upper bound"}


@dataclass(frozen=True, slots=True)
class AutoscalingConfig:
    trigger_drain_seconds: float = 120.0
    scale_up_delay_seconds: float = 60.0
    scale_factor: float = 2.0

    def __post_init__(self) -> None:
        if self.trigger_drain_seconds <= 0 or self.scale_up_delay_seconds < 0 or self.scale_factor <= 1:
            raise ValueError("autoscaling trigger must be positive, delay non-negative and scale factor greater than one")


@dataclass(frozen=True, slots=True)
class AutoscalingRun:
    seed: int
    strategy: AutoscalingStrategy
    metrics: AdmissionRunMetrics
    overload_detected_at_seconds: float | None
    scale_effective_at_seconds: float | None
    scaled_worker_count: int


@dataclass(frozen=True, slots=True)
class AutoscalingSummary:
    strategy: AutoscalingStrategy
    admitted_rate: MetricEstimate
    rejected_rate: MetricEstimate
    high_priority_acceptance_rate: MetricEstimate
    p95_end_to_end_seconds: MetricEstimate
    p99_end_to_end_seconds: MetricEstimate
    completion_slo_rate: MetricEstimate
    recovery_after_last_arrival_seconds: MetricEstimate
    worker_capacity_seconds: MetricEstimate
    slo_tasks_per_1000_worker_seconds: MetricEstimate
    scale_activation_rate: float
    scale_effective_after_first_arrival_seconds: MetricEstimate


@dataclass(frozen=True, slots=True)
class AutoscalingBenchmark:
    config: SchedulerExperimentConfig
    admission_config: AdmissionConfig
    autoscaling_config: AutoscalingConfig
    scheduler_policy: SchedulingPolicy
    rows: tuple[AutoscalingRun, ...]
    summaries: tuple[AutoscalingSummary, ...]
    offered_load_ratio: MetricEstimate


def detect_overload_at(tasks: Sequence[SchedulerTask], worker_count: int, trigger_drain_seconds: float) -> float | None:
    if not tasks or worker_count < 1 or trigger_drain_seconds <= 0:
        raise ValueError("tasks, worker count and trigger must be valid")
    ordered = sorted(tasks, key=lambda task: (task.queued_at_seconds, task.task_id))
    backlog_work = 0.0
    previous_arrival = ordered[0].queued_at_seconds
    for task in ordered:
        elapsed = task.queued_at_seconds - previous_arrival
        backlog_work = max(0.0, backlog_work - worker_count * elapsed)
        if not task.cache_hit:
            backlog_work += task.predicted_runtime_seconds
        if backlog_work / worker_count > trigger_drain_seconds:
            return task.queued_at_seconds
        previous_arrival = task.queued_at_seconds
    return None


def _strategy_settings(tasks: Sequence[SchedulerTask], strategy: AutoscalingStrategy, worker_count: int, config: AutoscalingConfig) -> tuple[AdmissionPolicy, float | None, tuple[WorkerCapacityEvent, ...], int]:
    overload_at = detect_overload_at(tasks, worker_count, config.trigger_drain_seconds)
    scaled_worker_count = max(worker_count + 1, math.ceil(worker_count * config.scale_factor))
    if strategy is AutoscalingStrategy.STATIC_ACCEPT_ALL:
        return AdmissionPolicy.ACCEPT_ALL, overload_at, (), worker_count
    if strategy is AutoscalingStrategy.STATIC_PRIORITY_SHED:
        return AdmissionPolicy.PRIORITY_SHED, overload_at, (), worker_count
    if strategy is AutoscalingStrategy.PREDICTIVE_SCALE:
        first_arrival = min(task.queued_at_seconds for task in tasks)
        return AdmissionPolicy.ACCEPT_ALL, overload_at, tuple([WorkerCapacityEvent(at_seconds=first_arrival, worker_count=scaled_worker_count)]), scaled_worker_count
    if overload_at is None:
        admission_policy = AdmissionPolicy.PRIORITY_SHED if strategy is AutoscalingStrategy.SHED_THEN_SCALE else AdmissionPolicy.ACCEPT_ALL
        return admission_policy, None, (), worker_count
    scale_at = overload_at + config.scale_up_delay_seconds
    admission_policy = AdmissionPolicy.PRIORITY_SHED if strategy is AutoscalingStrategy.SHED_THEN_SCALE else AdmissionPolicy.ACCEPT_ALL
    return admission_policy, overload_at, tuple([WorkerCapacityEvent(at_seconds=scale_at, worker_count=scaled_worker_count)]), scaled_worker_count


def simulate_autoscaling_strategy(tasks: Sequence[SchedulerTask], strategy: AutoscalingStrategy, *, seed: int, worker_count: int, admission_config: AdmissionConfig | None = None, autoscaling_config: AutoscalingConfig | None = None, scheduler_policy: SchedulingPolicy = SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING, max_wait_seconds: float = 120.0, aging_rate: float = 0.02, aging_overdue_interval: int = 4) -> AutoscalingRun:
    selected_admission = admission_config or AdmissionConfig()
    selected_autoscaling = autoscaling_config or AutoscalingConfig()
    admission_policy, overload_at, capacity_events, scaled_worker_count = _strategy_settings(tasks, strategy, worker_count, selected_autoscaling)
    result = simulate_admission_policy(tasks, admission_policy, worker_count=worker_count, scheduler_policy=scheduler_policy, admission_config=selected_admission, max_wait_seconds=max_wait_seconds, aging_rate=aging_rate, aging_overdue_interval=aging_overdue_interval, capacity_events=capacity_events)
    scale_effective_at = capacity_events[0].at_seconds if capacity_events else None
    return AutoscalingRun(seed=seed, strategy=strategy, metrics=result.metrics, overload_detected_at_seconds=overload_at, scale_effective_at_seconds=scale_effective_at, scaled_worker_count=scaled_worker_count)


def _summarize_autoscaling(rows: Sequence[AutoscalingRun], strategy: AutoscalingStrategy, first_arrivals: dict[int, float]) -> AutoscalingSummary:
    selected = [row for row in rows if row.strategy is strategy]
    scale_delays = [0.0 if row.scale_effective_at_seconds is None else row.scale_effective_at_seconds - first_arrivals[row.seed] for row in selected]
    return AutoscalingSummary(strategy=strategy, admitted_rate=_estimate([row.metrics.admitted_rate for row in selected]), rejected_rate=_estimate([row.metrics.rejected_rate for row in selected]), high_priority_acceptance_rate=_estimate([row.metrics.high_priority_acceptance_rate for row in selected]), p95_end_to_end_seconds=_estimate([row.metrics.p95_end_to_end_seconds for row in selected]), p99_end_to_end_seconds=_estimate([row.metrics.p99_end_to_end_seconds for row in selected]), completion_slo_rate=_estimate([row.metrics.completion_slo_rate for row in selected]), recovery_after_last_arrival_seconds=_estimate([row.metrics.recovery_after_last_arrival_seconds for row in selected]), worker_capacity_seconds=_estimate([row.metrics.worker_capacity_seconds for row in selected]), slo_tasks_per_1000_worker_seconds=_estimate([row.metrics.slo_tasks_per_1000_worker_seconds for row in selected]), scale_activation_rate=sum(row.scale_effective_at_seconds is not None for row in selected) / len(selected), scale_effective_after_first_arrival_seconds=_estimate(scale_delays))


def run_autoscaling_benchmark(config: SchedulerExperimentConfig, *, admission_config: AdmissionConfig | None = None, autoscaling_config: AutoscalingConfig | None = None, scheduler_policy: SchedulingPolicy = SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING, strategies: Sequence[AutoscalingStrategy] = tuple(AutoscalingStrategy), seeds: Sequence[int] = (11, 23, 37, 42, 59)) -> AutoscalingBenchmark:
    if not seeds or not strategies:
        raise ValueError("seeds and strategies must not be empty")
    selected_admission = admission_config or AdmissionConfig()
    selected_autoscaling = autoscaling_config or AutoscalingConfig()
    rows: list[AutoscalingRun] = []
    loads: list[float] = []
    first_arrivals: dict[int, float] = {}
    for seed in seeds:
        tasks, prediction_metrics = generate_scheduler_workload(config, random_seed=seed)
        loads.append(prediction_metrics[3])
        first_arrivals[seed] = min(task.queued_at_seconds for task in tasks)
        for strategy in strategies:
            rows.append(simulate_autoscaling_strategy(tasks, strategy, seed=seed, worker_count=config.worker_count, admission_config=selected_admission, autoscaling_config=selected_autoscaling, scheduler_policy=scheduler_policy, max_wait_seconds=config.max_wait_seconds, aging_rate=config.aging_rate, aging_overdue_interval=config.aging_overdue_interval))
    summaries = tuple(_summarize_autoscaling(rows, strategy, first_arrivals) for strategy in strategies)
    return AutoscalingBenchmark(config=config, admission_config=selected_admission, autoscaling_config=selected_autoscaling, scheduler_policy=scheduler_policy, rows=tuple(rows), summaries=summaries, offered_load_ratio=_estimate(loads))
