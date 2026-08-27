from __future__ import annotations

import math
import random
from collections.abc import Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from statistics import mean

from .autoscaling_simulation import detect_overload_at
from .overload_simulation import AdmissionConfig, AdmissionPolicy, AdmissionPolicyEvent, AdmissionRunMetrics, simulate_admission_policy, worker_capacity_between
from .scheduler_simulation import MetricEstimate, SchedulerExperimentConfig, SchedulerTask, SchedulingPolicy, WorkerCapacityEvent, _estimate, generate_scheduler_workload


class ScalingReliabilityStrategy(StrEnum):
    STATIC_ACCEPT_ALL = "static_accept_all"
    IMMEDIATE_PRIORITY_SHED = "immediate_priority_shed"
    SCALE_ONLY = "scale_only"
    SHED_THEN_SCALE = "shed_then_scale"
    SCALE_THEN_FALLBACK_SHED = "scale_then_fallback_shed"


SCALING_RELIABILITY_LABELS = {ScalingReliabilityStrategy.STATIC_ACCEPT_ALL: "Static accept all", ScalingReliabilityStrategy.IMMEDIATE_PRIORITY_SHED: "Immediate priority shed", ScalingReliabilityStrategy.SCALE_ONLY: "Scale only", ScalingReliabilityStrategy.SHED_THEN_SCALE: "Shed then scale", ScalingReliabilityStrategy.SCALE_THEN_FALLBACK_SHED: "Scale then fallback shed"}


@dataclass(frozen=True, slots=True)
class ScalingReliabilityConfig:
    trigger_drain_seconds: float = 120.0
    scale_up_delay_seconds: float = 60.0
    scale_hard_deadline_seconds: float = 120.0
    scale_factor: float = 2.0
    scale_success_probability: float = 0.8
    scale_down_cooldown_seconds: float = 120.0
    minimum_scale_billing_seconds: float = 300.0
    worker_hour_cost: float = 0.12

    def __post_init__(self) -> None:
        if self.trigger_drain_seconds <= 0 or self.scale_up_delay_seconds < 0 or self.scale_hard_deadline_seconds <= 0:
            raise ValueError("scaling timing values must be positive except scale-up delay")
        if self.scale_up_delay_seconds > self.scale_hard_deadline_seconds:
            raise ValueError("scale-up delay must not exceed the hard deadline")
        if self.scale_factor <= 1 or not 0 <= self.scale_success_probability <= 1:
            raise ValueError("scale factor and success probability are invalid")
        if self.scale_down_cooldown_seconds < 0 or self.minimum_scale_billing_seconds < 0 or self.worker_hour_cost <= 0:
            raise ValueError("billing and scale-down values must be non-negative with positive worker cost")


@dataclass(frozen=True, slots=True)
class ReliabilityWorkload:
    seed: int
    tasks: tuple[SchedulerTask, ...]
    offered_load_ratio: float


@dataclass(frozen=True, slots=True)
class ScalingReliabilityRun:
    seed: int
    strategy: ScalingReliabilityStrategy
    metrics: AdmissionRunMetrics
    scale_attempted: bool
    scale_succeeded: bool
    overload_detected_at_seconds: float | None
    scale_effective_at_seconds: float | None
    fallback_activated_at_seconds: float | None
    scale_down_at_seconds: float | None
    peak_worker_count: int
    billed_worker_seconds: float
    estimated_worker_cost: float
    slo_tasks_per_worker_dollar: float


@dataclass(frozen=True, slots=True)
class ScalingReliabilitySummary:
    strategy: ScalingReliabilityStrategy
    rejected_rate: MetricEstimate
    high_priority_acceptance_rate: MetricEstimate
    p95_end_to_end_seconds: MetricEstimate
    completion_slo_rate: MetricEstimate
    recovery_after_last_arrival_seconds: MetricEstimate
    billed_worker_seconds: MetricEstimate
    estimated_worker_cost: MetricEstimate
    slo_tasks_per_worker_dollar: MetricEstimate
    scale_attempt_rate: float
    scale_success_rate: float
    fallback_activation_rate: float


@dataclass(frozen=True, slots=True)
class ScalingReliabilityBenchmark:
    config: SchedulerExperimentConfig
    admission_config: AdmissionConfig
    reliability_config: ScalingReliabilityConfig
    scheduler_policy: SchedulingPolicy
    rows: tuple[ScalingReliabilityRun, ...]
    summaries: tuple[ScalingReliabilitySummary, ...]
    offered_load_ratio: MetricEstimate


@dataclass(frozen=True, slots=True)
class ExpectedScalingReliabilityBenchmark:
    config: SchedulerExperimentConfig
    admission_config: AdmissionConfig
    reliability_config: ScalingReliabilityConfig
    scheduler_policy: SchedulingPolicy
    summaries: tuple[ScalingReliabilitySummary, ...]
    offered_load_ratio: MetricEstimate


def generate_reliability_workloads(config: SchedulerExperimentConfig, seeds: Sequence[int]) -> tuple[ReliabilityWorkload, ...]:
    if not seeds:
        raise ValueError("seeds must not be empty")
    workloads: list[ReliabilityWorkload] = []
    for seed in seeds:
        tasks, prediction_metrics = generate_scheduler_workload(config, random_seed=seed)
        workloads.append(ReliabilityWorkload(seed=seed, tasks=tasks, offered_load_ratio=prediction_metrics[3]))
    return tuple(workloads)


def _scale_succeeds(seed: int, probability: float) -> bool:
    return random.Random(seed ^ 104_729).random() < probability


def _debounced_scale_down_at(tasks: Sequence[SchedulerTask], scale_at: float, config: ScalingReliabilityConfig) -> float:
    minimum_end = scale_at + config.minimum_scale_billing_seconds
    candidate = max(minimum_end, scale_at + config.scale_down_cooldown_seconds)
    arrivals = sorted(task.queued_at_seconds for task in tasks if task.queued_at_seconds >= scale_at)
    for arrival in arrivals:
        if arrival >= candidate:
            return candidate
        candidate = max(minimum_end, arrival + config.scale_down_cooldown_seconds)
    return candidate


def _strategy_events(tasks: Sequence[SchedulerTask], strategy: ScalingReliabilityStrategy, worker_count: int, config: ScalingReliabilityConfig, scale_succeeded: bool) -> tuple[AdmissionPolicy, float | None, tuple[WorkerCapacityEvent, ...], tuple[AdmissionPolicyEvent, ...], float | None, float | None, int, bool]:
    overload_at = detect_overload_at(tasks, worker_count, config.trigger_drain_seconds)
    if strategy is ScalingReliabilityStrategy.STATIC_ACCEPT_ALL:
        return AdmissionPolicy.ACCEPT_ALL, overload_at, (), (), None, None, worker_count, False
    if strategy is ScalingReliabilityStrategy.IMMEDIATE_PRIORITY_SHED:
        return AdmissionPolicy.PRIORITY_SHED, overload_at, (), (), None, None, worker_count, False
    initial_policy = AdmissionPolicy.PRIORITY_SHED if strategy is ScalingReliabilityStrategy.SHED_THEN_SCALE else AdmissionPolicy.ACCEPT_ALL
    if overload_at is None:
        return initial_policy, None, (), (), None, None, worker_count, False
    fallback_at = overload_at + config.scale_hard_deadline_seconds if strategy is ScalingReliabilityStrategy.SCALE_THEN_FALLBACK_SHED and not scale_succeeded else None
    policy_events = () if fallback_at is None else tuple([AdmissionPolicyEvent(at_seconds=fallback_at, policy=AdmissionPolicy.PRIORITY_SHED)])
    if not scale_succeeded:
        return initial_policy, overload_at, (), policy_events, None, fallback_at, worker_count, True
    scaled_worker_count = max(worker_count + 1, math.ceil(worker_count * config.scale_factor))
    scale_at = overload_at + config.scale_up_delay_seconds
    scale_down_at = _debounced_scale_down_at(tasks, scale_at, config)
    capacity_events = (WorkerCapacityEvent(at_seconds=scale_at, worker_count=scaled_worker_count), WorkerCapacityEvent(at_seconds=scale_down_at, worker_count=worker_count))
    return initial_policy, overload_at, capacity_events, policy_events, scale_at, fallback_at, scaled_worker_count, True


def simulate_scaling_reliability_strategy(tasks: Sequence[SchedulerTask], strategy: ScalingReliabilityStrategy, *, seed: int, worker_count: int, admission_config: AdmissionConfig | None = None, reliability_config: ScalingReliabilityConfig | None = None, scheduler_policy: SchedulingPolicy = SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING, max_wait_seconds: float = 120.0, aging_rate: float = 0.02, aging_overdue_interval: int = 4) -> ScalingReliabilityRun:
    if not tasks:
        raise ValueError("tasks must not be empty")
    selected_admission = admission_config or AdmissionConfig()
    selected_reliability = reliability_config or ScalingReliabilityConfig()
    sampled_success = _scale_succeeds(seed, selected_reliability.scale_success_probability)
    admission_policy, overload_at, capacity_events, policy_events, scale_at, fallback_at, peak_workers, scale_attempted = _strategy_events(tasks, strategy, worker_count, selected_reliability, sampled_success)
    result = simulate_admission_policy(tasks, admission_policy, worker_count=worker_count, scheduler_policy=scheduler_policy, admission_config=selected_admission, max_wait_seconds=max_wait_seconds, aging_rate=aging_rate, aging_overdue_interval=aging_overdue_interval, capacity_events=capacity_events, policy_events=policy_events)
    first_arrival = min(task.queued_at_seconds for task in tasks)
    last_arrival = max(task.queued_at_seconds for task in tasks)
    last_completion = last_arrival + result.metrics.recovery_after_last_arrival_seconds
    scale_down_at = capacity_events[-1].at_seconds if capacity_events else None
    billing_end = max(last_completion, scale_down_at or last_completion)
    billed_worker_seconds = worker_capacity_between(first_arrival, billing_end, worker_count, capacity_events)
    estimated_worker_cost = billed_worker_seconds * selected_reliability.worker_hour_cost / 3_600
    slo_task_count = result.metrics.completion_slo_rate * len(tasks)
    slo_tasks_per_worker_dollar = 0.0 if estimated_worker_cost == 0 else slo_task_count / estimated_worker_cost
    return ScalingReliabilityRun(seed=seed, strategy=strategy, metrics=result.metrics, scale_attempted=scale_attempted, scale_succeeded=scale_attempted and sampled_success, overload_detected_at_seconds=overload_at, scale_effective_at_seconds=scale_at, fallback_activated_at_seconds=fallback_at, scale_down_at_seconds=scale_down_at, peak_worker_count=peak_workers, billed_worker_seconds=billed_worker_seconds, estimated_worker_cost=estimated_worker_cost, slo_tasks_per_worker_dollar=slo_tasks_per_worker_dollar)


def _summarize_reliability(rows: Sequence[ScalingReliabilityRun], strategy: ScalingReliabilityStrategy) -> ScalingReliabilitySummary:
    selected = [row for row in rows if row.strategy is strategy]
    attempts = sum(row.scale_attempted for row in selected)
    return ScalingReliabilitySummary(strategy=strategy, rejected_rate=_estimate([row.metrics.rejected_rate for row in selected]), high_priority_acceptance_rate=_estimate([row.metrics.high_priority_acceptance_rate for row in selected]), p95_end_to_end_seconds=_estimate([row.metrics.p95_end_to_end_seconds for row in selected]), completion_slo_rate=_estimate([row.metrics.completion_slo_rate for row in selected]), recovery_after_last_arrival_seconds=_estimate([row.metrics.recovery_after_last_arrival_seconds for row in selected]), billed_worker_seconds=_estimate([row.billed_worker_seconds for row in selected]), estimated_worker_cost=_estimate([row.estimated_worker_cost for row in selected]), slo_tasks_per_worker_dollar=_estimate([row.slo_tasks_per_worker_dollar for row in selected]), scale_attempt_rate=attempts / len(selected), scale_success_rate=0.0 if attempts == 0 else sum(row.scale_succeeded for row in selected) / attempts, fallback_activation_rate=sum(row.fallback_activated_at_seconds is not None for row in selected) / len(selected))


def _mixture_estimate(failure_values: Sequence[float], success_values: Sequence[float], success_probability: float) -> MetricEstimate:
    if len(failure_values) != len(success_values) or not failure_values:
        raise ValueError("failure and success samples must be non-empty and paired")
    expected_by_seed = [(1 - success_probability) * failure + success_probability * success for failure, success in zip(failure_values, success_values, strict=True)]
    average = mean(expected_by_seed)
    joint_variance = mean((1 - success_probability) * (failure - average) ** 2 + success_probability * (success - average) ** 2 for failure, success in zip(failure_values, success_values, strict=True))
    return MetricEstimate(mean=float(average), ci95=float(1.96 * math.sqrt(joint_variance / len(expected_by_seed))))


def _mix_run_metric(failure_rows: Sequence[ScalingReliabilityRun], success_rows: Sequence[ScalingReliabilityRun], success_probability: float, name: str, *, nested_metrics: bool) -> MetricEstimate:
    failure_values = [getattr(row.metrics if nested_metrics else row, name) for row in failure_rows]
    success_values = [getattr(row.metrics if nested_metrics else row, name) for row in success_rows]
    return _mixture_estimate(failure_values, success_values, success_probability)


def mix_scaling_reliability_benchmarks(failure_benchmark: ScalingReliabilityBenchmark, success_benchmark: ScalingReliabilityBenchmark, success_probability: float) -> ExpectedScalingReliabilityBenchmark:
    if not 0 <= success_probability <= 1:
        raise ValueError("success probability must be within [0, 1]")
    if failure_benchmark.config != success_benchmark.config or failure_benchmark.scheduler_policy is not success_benchmark.scheduler_policy:
        raise ValueError("counterfactual benchmarks must use identical workload and scheduler settings")
    strategies = tuple(summary.strategy for summary in failure_benchmark.summaries)
    if strategies != tuple(summary.strategy for summary in success_benchmark.summaries):
        raise ValueError("counterfactual benchmarks must contain identical strategies")
    summaries: list[ScalingReliabilitySummary] = []
    for strategy in strategies:
        failure_rows = [row for row in failure_benchmark.rows if row.strategy is strategy]
        success_rows = [row for row in success_benchmark.rows if row.strategy is strategy]
        if [row.seed for row in failure_rows] != [row.seed for row in success_rows]:
            raise ValueError("counterfactual benchmark rows must be paired by seed")
        attempts = (1 - success_probability) * sum(row.scale_attempted for row in failure_rows) + success_probability * sum(row.scale_attempted for row in success_rows)
        successes = success_probability * sum(row.scale_succeeded for row in success_rows)
        fallback_activations = (1 - success_probability) * sum(row.fallback_activated_at_seconds is not None for row in failure_rows) + success_probability * sum(row.fallback_activated_at_seconds is not None for row in success_rows)
        summaries.append(ScalingReliabilitySummary(strategy=strategy, rejected_rate=_mix_run_metric(failure_rows, success_rows, success_probability, "rejected_rate", nested_metrics=True), high_priority_acceptance_rate=_mix_run_metric(failure_rows, success_rows, success_probability, "high_priority_acceptance_rate", nested_metrics=True), p95_end_to_end_seconds=_mix_run_metric(failure_rows, success_rows, success_probability, "p95_end_to_end_seconds", nested_metrics=True), completion_slo_rate=_mix_run_metric(failure_rows, success_rows, success_probability, "completion_slo_rate", nested_metrics=True), recovery_after_last_arrival_seconds=_mix_run_metric(failure_rows, success_rows, success_probability, "recovery_after_last_arrival_seconds", nested_metrics=True), billed_worker_seconds=_mix_run_metric(failure_rows, success_rows, success_probability, "billed_worker_seconds", nested_metrics=False), estimated_worker_cost=_mix_run_metric(failure_rows, success_rows, success_probability, "estimated_worker_cost", nested_metrics=False), slo_tasks_per_worker_dollar=_mix_run_metric(failure_rows, success_rows, success_probability, "slo_tasks_per_worker_dollar", nested_metrics=False), scale_attempt_rate=attempts / len(failure_rows), scale_success_rate=0.0 if attempts == 0 else successes / attempts, fallback_activation_rate=fallback_activations / len(failure_rows)))
    selected_config = replace(failure_benchmark.reliability_config, scale_success_probability=success_probability)
    return ExpectedScalingReliabilityBenchmark(config=failure_benchmark.config, admission_config=failure_benchmark.admission_config, reliability_config=selected_config, scheduler_policy=failure_benchmark.scheduler_policy, summaries=tuple(summaries), offered_load_ratio=failure_benchmark.offered_load_ratio)


def run_scaling_reliability_benchmark(config: SchedulerExperimentConfig, *, admission_config: AdmissionConfig | None = None, reliability_config: ScalingReliabilityConfig | None = None, scheduler_policy: SchedulingPolicy = SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING, strategies: Sequence[ScalingReliabilityStrategy] = tuple(ScalingReliabilityStrategy), seeds: Sequence[int] = (11, 23, 37, 42, 59), workloads: Sequence[ReliabilityWorkload] | None = None) -> ScalingReliabilityBenchmark:
    if not strategies or not seeds:
        raise ValueError("strategies and seeds must not be empty")
    selected_admission = admission_config or AdmissionConfig()
    selected_reliability = reliability_config or ScalingReliabilityConfig()
    selected_workloads = tuple(workloads) if workloads is not None else generate_reliability_workloads(config, seeds)
    if tuple(workload.seed for workload in selected_workloads) != tuple(seeds):
        raise ValueError("workload seeds must match requested seeds in order")
    rows = tuple(simulate_scaling_reliability_strategy(workload.tasks, strategy, seed=workload.seed, worker_count=config.worker_count, admission_config=selected_admission, reliability_config=selected_reliability, scheduler_policy=scheduler_policy, max_wait_seconds=config.max_wait_seconds, aging_rate=config.aging_rate, aging_overdue_interval=config.aging_overdue_interval) for workload in selected_workloads for strategy in strategies)
    summaries = tuple(_summarize_reliability(rows, strategy) for strategy in strategies)
    return ScalingReliabilityBenchmark(config=config, admission_config=selected_admission, reliability_config=selected_reliability, scheduler_policy=scheduler_policy, rows=rows, summaries=summaries, offered_load_ratio=_estimate([workload.offered_load_ratio for workload in selected_workloads]))
