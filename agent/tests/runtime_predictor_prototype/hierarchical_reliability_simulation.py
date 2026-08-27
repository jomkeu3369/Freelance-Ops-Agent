from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from statistics import mean

from .hierarchical_scheduler_simulation import HierarchicalConfig, HierarchicalMetrics, HierarchicalStrategy, simulate_hierarchical_strategy
from .scheduler_simulation import MetricEstimate, SchedulerTask, _estimate
from .tenant_fairness_simulation import TenantFairnessScenario, generate_tenant_fairness_workload


class HierarchicalReliabilityStrategy(StrEnum):
    STATIC_HIERARCHICAL = "static_hierarchical"
    SCALE_ONLY = "scale_only"
    SCALE_THEN_GLOBAL_GUARD = "scale_then_global_guard"
    SCALE_THEN_WORKSPACE_QUOTA = "scale_then_workspace_quota"
    SCALE_THEN_HIERARCHICAL_FALLBACK = "scale_then_hierarchical_fallback"


RELIABILITY_LABELS = {HierarchicalReliabilityStrategy.STATIC_HIERARCHICAL: "Static hierarchical", HierarchicalReliabilityStrategy.SCALE_ONLY: "Scale only", HierarchicalReliabilityStrategy.SCALE_THEN_GLOBAL_GUARD: "Scale → global guard", HierarchicalReliabilityStrategy.SCALE_THEN_WORKSPACE_QUOTA: "Scale → workspace quota", HierarchicalReliabilityStrategy.SCALE_THEN_HIERARCHICAL_FALLBACK: "Scale → hierarchical fallback"}


@dataclass(frozen=True, slots=True)
class HierarchicalReliabilityConfig:
    scale_success_probability: float = 0.90
    scale_down_cooldown_seconds: float = 60.0
    minimum_scale_billing_seconds: float = 600.0
    worker_hour_cost: float = 0.12
    prediction_multiplier: float = 1.0

    def __post_init__(self) -> None:
        if not 0 <= self.scale_success_probability <= 1:
            raise ValueError("scale_success_probability must be within [0, 1]")
        if self.scale_down_cooldown_seconds < 0 or self.minimum_scale_billing_seconds < 0 or self.worker_hour_cost <= 0 or self.prediction_multiplier <= 0:
            raise ValueError("cooldown, billing, cost and prediction multiplier are invalid")


@dataclass(frozen=True, slots=True)
class ReliabilityStateRun:
    seed: int
    scenario: TenantFairnessScenario
    strategy: HierarchicalReliabilityStrategy
    scale_succeeded: bool
    scale_attempted: bool
    fallback_activated: bool
    metrics: HierarchicalMetrics
    billed_worker_seconds: float
    estimated_worker_cost: float
    slo_tasks_per_worker_dollar: float


@dataclass(frozen=True, slots=True)
class ExpectedReliabilitySummary:
    strategy: HierarchicalReliabilityStrategy
    admitted_rate: MetricEstimate
    completion_slo_goodput: MetricEstimate
    high_priority_wait_slo_goodput: MetricEstimate
    worst_workspace_completion_goodput: MetricEstimate
    workspace_acceptance_fairness: MetricEstimate
    p95_end_to_end_seconds: MetricEstimate
    maximum_wait_seconds: MetricEstimate
    billed_worker_seconds: MetricEstimate
    estimated_worker_cost: MetricEstimate
    slo_tasks_per_worker_dollar: MetricEstimate
    expected_hard_gate_pass_rate: float
    scale_attempt_rate: float
    scale_success_rate: float
    fallback_activation_rate: float


@dataclass(frozen=True, slots=True)
class HierarchicalReliabilityBenchmark:
    hierarchical_config: HierarchicalConfig
    reliability_config: HierarchicalReliabilityConfig
    success_rows: tuple[ReliabilityStateRun, ...]
    failure_rows: tuple[ReliabilityStateRun, ...]
    summaries: tuple[ExpectedReliabilitySummary, ...]
    selected_strategy: HierarchicalReliabilityStrategy | None


def _fallback_strategy(strategy: HierarchicalReliabilityStrategy) -> HierarchicalStrategy | None:
    if strategy is HierarchicalReliabilityStrategy.SCALE_THEN_GLOBAL_GUARD:
        return HierarchicalStrategy.GLOBAL_GUARD
    if strategy is HierarchicalReliabilityStrategy.SCALE_THEN_WORKSPACE_QUOTA:
        return HierarchicalStrategy.WORKSPACE_QUOTA
    if strategy is HierarchicalReliabilityStrategy.SCALE_THEN_HIERARCHICAL_FALLBACK:
        return HierarchicalStrategy.HIERARCHICAL_STATIC
    return None


def _with_prediction_multiplier(tasks: Sequence[SchedulerTask], multiplier: float) -> tuple[SchedulerTask, ...]:
    return tuple(replace(task, predicted_runtime_seconds=max(0.01, task.predicted_runtime_seconds * multiplier)) for task in tasks)


def _scale_down_at(tasks: Sequence[SchedulerTask], scale_at_seconds: float, config: HierarchicalReliabilityConfig) -> float:
    minimum_end = scale_at_seconds + config.minimum_scale_billing_seconds
    candidate = max(minimum_end, scale_at_seconds + config.scale_down_cooldown_seconds)
    for arrival in sorted(task.queued_at_seconds for task in tasks if task.queued_at_seconds >= scale_at_seconds):
        if arrival >= candidate:
            return candidate
        candidate = max(minimum_end, arrival + config.scale_down_cooldown_seconds)
    return candidate


def _hard_gate(metrics: HierarchicalMetrics) -> bool:
    return metrics.completion_slo_goodput >= 0.95 and metrics.high_priority_wait_slo_goodput >= 0.95 and metrics.worst_workspace_completion_goodput >= 0.90 and metrics.workspace_acceptance_fairness >= 0.90 and metrics.maximum_wait_seconds <= 300.0


def _state_run(tasks: Sequence[SchedulerTask], strategy: HierarchicalReliabilityStrategy, *, seed: int, scenario: TenantFairnessScenario, scale_succeeded: bool, hierarchical_config: HierarchicalConfig, reliability_config: HierarchicalReliabilityConfig) -> ReliabilityStateRun:
    adjusted_tasks = _with_prediction_multiplier(tasks, reliability_config.prediction_multiplier)
    if strategy is HierarchicalReliabilityStrategy.STATIC_HIERARCHICAL:
        run = simulate_hierarchical_strategy(adjusted_tasks, HierarchicalStrategy.HIERARCHICAL_STATIC, seed=seed, scenario=scenario, config=hierarchical_config)
        scale_attempted = False
        fallback_activated = False
    else:
        fallback = _fallback_strategy(strategy)
        run = simulate_hierarchical_strategy(adjusted_tasks, HierarchicalStrategy.HIERARCHICAL_SCALE, seed=seed, scenario=scenario, config=hierarchical_config, scale_succeeds=scale_succeeded, failure_fallback=fallback)
        successful_plan = simulate_hierarchical_strategy(adjusted_tasks, HierarchicalStrategy.HIERARCHICAL_SCALE, seed=seed, scenario=scenario, config=hierarchical_config)
        scale_attempted = bool(successful_plan.capacity_events)
        fallback_activated = scale_attempted and not scale_succeeded and fallback is not None
    first_arrival = min(task.queued_at_seconds for task in adjusted_tasks)
    last_completion = max(result.completed_at_seconds for result in run.task_results)
    base_worker_seconds = hierarchical_config.worker_count * (last_completion - first_arrival)
    extra_worker_seconds = 0.0
    if scale_attempted and scale_succeeded:
        successful_plan = run
        scale_at = successful_plan.capacity_events[0].at_seconds
        scaled_workers = successful_plan.capacity_events[0].worker_count
        scale_down_at = _scale_down_at(adjusted_tasks, scale_at, reliability_config)
        extra_worker_seconds = (scaled_workers - hierarchical_config.worker_count) * max(reliability_config.minimum_scale_billing_seconds, scale_down_at - scale_at)
    billed_worker_seconds = base_worker_seconds + extra_worker_seconds
    estimated_worker_cost = billed_worker_seconds * reliability_config.worker_hour_cost / 3_600
    completed_slo_tasks = run.metrics.completion_slo_goodput * len(adjusted_tasks)
    slo_tasks_per_worker_dollar = 0.0 if estimated_worker_cost == 0 else completed_slo_tasks / estimated_worker_cost
    return ReliabilityStateRun(seed=seed, scenario=scenario, strategy=strategy, scale_succeeded=scale_succeeded, scale_attempted=scale_attempted, fallback_activated=fallback_activated, metrics=run.metrics, billed_worker_seconds=billed_worker_seconds, estimated_worker_cost=estimated_worker_cost, slo_tasks_per_worker_dollar=slo_tasks_per_worker_dollar)


def generate_reliability_state_rows(*, hierarchical_config: HierarchicalConfig | None = None, reliability_config: HierarchicalReliabilityConfig | None = None, seeds: Sequence[int] = (11, 23, 37, 42, 59), scenarios: Sequence[TenantFairnessScenario] = tuple(TenantFairnessScenario), strategies: Sequence[HierarchicalReliabilityStrategy] = tuple(HierarchicalReliabilityStrategy)) -> tuple[tuple[ReliabilityStateRun, ...], tuple[ReliabilityStateRun, ...]]:
    if not seeds or not scenarios or not strategies:
        raise ValueError("seeds, scenarios and strategies must not be empty")
    selected_hierarchical = hierarchical_config or HierarchicalConfig()
    selected_reliability = reliability_config or HierarchicalReliabilityConfig()
    success_rows: list[ReliabilityStateRun] = []
    failure_rows: list[ReliabilityStateRun] = []
    for scenario in scenarios:
        for seed in seeds:
            tasks = generate_tenant_fairness_workload(scenario, seed=seed)
            for strategy in strategies:
                success_rows.append(_state_run(tasks, strategy, seed=seed, scenario=scenario, scale_succeeded=True, hierarchical_config=selected_hierarchical, reliability_config=selected_reliability))
                failure_rows.append(_state_run(tasks, strategy, seed=seed, scenario=scenario, scale_succeeded=False, hierarchical_config=selected_hierarchical, reliability_config=selected_reliability))
    return tuple(success_rows), tuple(failure_rows)


def _paired_rows(success_rows: Sequence[ReliabilityStateRun], failure_rows: Sequence[ReliabilityStateRun], strategy: HierarchicalReliabilityStrategy) -> tuple[list[ReliabilityStateRun], list[ReliabilityStateRun]]:
    success = [row for row in success_rows if row.strategy is strategy]
    failure = [row for row in failure_rows if row.strategy is strategy]
    success_keys = [(row.scenario, row.seed) for row in success]
    failure_keys = [(row.scenario, row.seed) for row in failure]
    if success_keys != failure_keys or not success:
        raise ValueError("success and failure rows must be non-empty and paired")
    return success, failure


def _mixture(success: Sequence[float], failure: Sequence[float], probability: float) -> MetricEstimate:
    expected = [probability * success_value + (1 - probability) * failure_value for success_value, failure_value in zip(success, failure, strict=True)]
    return _estimate(expected)


def _metric(row: ReliabilityStateRun, name: str) -> float:
    return float(getattr(row.metrics, name))


def summarize_expected_reliability(success_rows: Sequence[ReliabilityStateRun], failure_rows: Sequence[ReliabilityStateRun], strategy: HierarchicalReliabilityStrategy, scale_success_probability: float) -> ExpectedReliabilitySummary:
    if not 0 <= scale_success_probability <= 1:
        raise ValueError("scale_success_probability must be within [0, 1]")
    success, failure = _paired_rows(success_rows, failure_rows, strategy)

    def metric_estimate(name: str) -> MetricEstimate:
        return _mixture([_metric(row, name) for row in success], [_metric(row, name) for row in failure], scale_success_probability)

    def direct_estimate(name: str) -> MetricEstimate:
        return _mixture([float(getattr(row, name)) for row in success], [float(getattr(row, name)) for row in failure], scale_success_probability)
    hard_gate_probability = mean(scale_success_probability * float(_hard_gate(success_row.metrics)) + (1 - scale_success_probability) * float(_hard_gate(failure_row.metrics)) for success_row, failure_row in zip(success, failure, strict=True))
    attempts = mean(float(row.scale_attempted) for row in success)
    scale_success_rate = scale_success_probability if attempts > 0 else 0.0
    fallback_activation_rate = (1 - scale_success_probability) * mean(float(row.fallback_activated) for row in failure)
    return ExpectedReliabilitySummary(strategy=strategy, admitted_rate=metric_estimate("admitted_rate"), completion_slo_goodput=metric_estimate("completion_slo_goodput"), high_priority_wait_slo_goodput=metric_estimate("high_priority_wait_slo_goodput"), worst_workspace_completion_goodput=metric_estimate("worst_workspace_completion_goodput"), workspace_acceptance_fairness=metric_estimate("workspace_acceptance_fairness"), p95_end_to_end_seconds=metric_estimate("p95_end_to_end_seconds"), maximum_wait_seconds=metric_estimate("maximum_wait_seconds"), billed_worker_seconds=direct_estimate("billed_worker_seconds"), estimated_worker_cost=direct_estimate("estimated_worker_cost"), slo_tasks_per_worker_dollar=direct_estimate("slo_tasks_per_worker_dollar"), expected_hard_gate_pass_rate=hard_gate_probability, scale_attempt_rate=attempts, scale_success_rate=scale_success_rate, fallback_activation_rate=fallback_activation_rate)


def build_expected_reliability_benchmark(*, hierarchical_config: HierarchicalConfig | None = None, reliability_config: HierarchicalReliabilityConfig | None = None, seeds: Sequence[int] = (11, 23, 37, 42, 59), scenarios: Sequence[TenantFairnessScenario] = tuple(TenantFairnessScenario), strategies: Sequence[HierarchicalReliabilityStrategy] = tuple(HierarchicalReliabilityStrategy), state_rows: tuple[Sequence[ReliabilityStateRun], Sequence[ReliabilityStateRun]] | None = None) -> HierarchicalReliabilityBenchmark:
    selected_hierarchical = hierarchical_config or HierarchicalConfig()
    selected_reliability = reliability_config or HierarchicalReliabilityConfig()
    success_rows, failure_rows = state_rows or generate_reliability_state_rows(hierarchical_config=selected_hierarchical, reliability_config=selected_reliability, seeds=seeds, scenarios=scenarios, strategies=strategies)
    summaries = tuple(summarize_expected_reliability(success_rows, failure_rows, strategy, selected_reliability.scale_success_probability) for strategy in strategies)
    eligible = [summary for summary in summaries if summary.completion_slo_goodput.mean >= 0.95 and summary.high_priority_wait_slo_goodput.mean >= 0.95 and summary.worst_workspace_completion_goodput.mean >= 0.90 and summary.workspace_acceptance_fairness.mean >= 0.90 and summary.expected_hard_gate_pass_rate >= 0.90]
    selected_strategy = max(eligible, key=lambda summary: summary.slo_tasks_per_worker_dollar.mean).strategy if eligible else None
    return HierarchicalReliabilityBenchmark(hierarchical_config=selected_hierarchical, reliability_config=selected_reliability, success_rows=tuple(success_rows), failure_rows=tuple(failure_rows), summaries=summaries, selected_strategy=selected_strategy)


def required_scale_success_probability(success_rows: Sequence[ReliabilityStateRun], failure_rows: Sequence[ReliabilityStateRun], strategy: HierarchicalReliabilityStrategy, *, step: float = 0.01) -> float | None:
    if not 0 < step <= 1:
        raise ValueError("step must be within (0, 1]")
    steps = math.ceil(1 / step)
    for index in range(steps + 1):
        probability = min(1.0, index * step)
        summary = summarize_expected_reliability(success_rows, failure_rows, strategy, probability)
        if summary.completion_slo_goodput.mean >= 0.95 and summary.high_priority_wait_slo_goodput.mean >= 0.95 and summary.worst_workspace_completion_goodput.mean >= 0.90 and summary.workspace_acceptance_fairness.mean >= 0.90 and summary.expected_hard_gate_pass_rate >= 0.90:
            return probability
    return None
