from __future__ import annotations

import math
import random
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from statistics import median

from .scheduler_simulation import MetricEstimate, SchedulerTask, SchedulingPolicy, TaskScheduleResult, _estimate, simulate_scheduler


class TenantFairnessScenario(StrEnum):
    NOISY_NEIGHBOR = "noisy_neighbor"
    SLEEP_WAKE_BURST = "sleep_wake_burst"
    ELEPHANT_AND_MICE = "elephant_and_mice"


TENANT_FAIRNESS_POLICIES = (SchedulingPolicy.FIFO, SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING, SchedulingPolicy.SLO_AWARE_PREDICTED_SJF, SchedulingPolicy.FAIR_PREDICTED_SJF_AGING, SchedulingPolicy.BOUNDED_FAIR_PREDICTED_SJF_AGING)
TENANT_FAIRNESS_POLICY_LABELS = {SchedulingPolicy.FIFO: "FIFO", SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING: "Global PSJF + Aging", SchedulingPolicy.SLO_AWARE_PREDICTED_SJF: "SLO-aware PSJF", SchedulingPolicy.FAIR_PREDICTED_SJF_AGING: "Legacy Fair PSJF", SchedulingPolicy.BOUNDED_FAIR_PREDICTED_SJF_AGING: "Bounded Fair PSJF"}
TENANT_SCENARIO_LABELS = {TenantFairnessScenario.NOISY_NEIGHBOR: "Noisy neighbor", TenantFairnessScenario.SLEEP_WAKE_BURST: "Sleep/wake burst", TenantFairnessScenario.ELEPHANT_AND_MICE: "Elephant and mice"}


@dataclass(frozen=True, slots=True)
class TenantFairnessConfig:
    worker_count: int = 6
    max_wait_seconds: float = 120.0
    high_priority_wait_seconds: float = 60.0
    high_priority_rescue_seconds: float = 0.0
    high_priority_reserved_workers: int = 0
    completion_slo_seconds: float = 300.0
    stress_window_start_seconds: float = 300.0
    stress_window_end_seconds: float = 420.0

    def __post_init__(self) -> None:
        if self.worker_count < 1:
            raise ValueError("worker_count must be positive")
        if not 0 <= self.high_priority_reserved_workers < self.worker_count:
            raise ValueError("high_priority_reserved_workers must be smaller than worker_count")
        if min(self.max_wait_seconds, self.high_priority_wait_seconds, self.completion_slo_seconds) <= 0 or self.high_priority_rescue_seconds < 0:
            raise ValueError("SLO values must be positive")
        if self.stress_window_start_seconds < 0 or self.stress_window_end_seconds <= self.stress_window_start_seconds:
            raise ValueError("stress window is invalid")


@dataclass(frozen=True, slots=True)
class TenantFairnessRow:
    seed: int
    scenario: TenantFairnessScenario
    policy: SchedulingPolicy
    mean_completion_seconds: float
    p95_wait_seconds: float
    maximum_wait_seconds: float
    worst_workspace_p95_wait_seconds: float
    workspace_p95_disparity: float
    fairness_index: float
    completion_slo_rate: float
    high_priority_violation_rate: float
    stress_service_share_error: float
    passed_gate: bool


@dataclass(frozen=True, slots=True)
class TenantFairnessSummary:
    policy: SchedulingPolicy
    mean_completion_seconds: MetricEstimate
    p95_wait_seconds: MetricEstimate
    maximum_wait_seconds: MetricEstimate
    worst_workspace_p95_wait_seconds: MetricEstimate
    workspace_p95_disparity: MetricEstimate
    fairness_index: MetricEstimate
    completion_slo_rate: MetricEstimate
    high_priority_violation_rate: MetricEstimate
    stress_service_share_error: MetricEstimate
    gate_pass_rate: float


@dataclass(frozen=True, slots=True)
class TenantFairnessBenchmark:
    config: TenantFairnessConfig
    rows: tuple[TenantFairnessRow, ...]
    summaries: tuple[TenantFairnessSummary, ...]
    selected_policy: SchedulingPolicy | None


def _task(task_id: str, workspace_id: str, queued_at: float, runtime: float, prediction: float, priority: int) -> SchedulerTask:
    return SchedulerTask(task_id=task_id, workspace_id=workspace_id, queued_at_seconds=max(0.0, queued_at), actual_runtime_seconds=max(0.1, runtime), predicted_runtime_seconds=max(0.1, prediction), priority=priority)


def _append_series(tasks: list[SchedulerTask], rng: random.Random, prefix: str, workspace_id: str, arrivals: Sequence[float], runtime_center: float, *, priority_probability: float = 0.1) -> None:
    for index, queued_at in enumerate(arrivals):
        runtime = runtime_center * math.exp(rng.gauss(-0.08, 0.35))
        prediction = runtime * math.exp(rng.gauss(0.0, 0.25))
        priority = 5 if rng.random() < priority_probability else rng.choices((2, 3, 4), weights=(0.15, 0.70, 0.15), k=1)[0]
        tasks.append(_task(f"{prefix}-{index:04d}", workspace_id, queued_at, runtime, prediction, priority))


def generate_tenant_fairness_workload(scenario: TenantFairnessScenario, *, seed: int) -> tuple[SchedulerTask, ...]:
    rng = random.Random(seed * 1009 + list(TenantFairnessScenario).index(scenario) * 7919)
    tasks: list[SchedulerTask] = []
    if scenario is TenantFairnessScenario.NOISY_NEIGHBOR:
        noisy_arrivals = [rng.uniform(0.0, 70.0) for _ in range(60)] + [rng.uniform(300.0, 370.0) for _ in range(60)]
        _append_series(tasks, rng, "noisy", "workspace-noisy", noisy_arrivals, 5.0)
        for workspace_index in range(3):
            arrivals = [index * 20.0 + rng.uniform(0.0, 3.0) for index in range(30)]
            _append_series(tasks, rng, f"quiet-{workspace_index}", f"workspace-quiet-{workspace_index}", arrivals, 30.0, priority_probability=0.15)
    elif scenario is TenantFairnessScenario.SLEEP_WAKE_BURST:
        continuous_a = [index * 5.0 + rng.uniform(0.0, 0.8) for index in range(120)]
        continuous_c = [index * 15.0 + rng.uniform(0.0, 1.5) for index in range(40)]
        returning = [rng.uniform(0.0, 12.0) for _ in range(8)] + [300.0 + rng.uniform(0.0, 20.0) for _ in range(25)]
        _append_series(tasks, rng, "continuous-a", "workspace-continuous-a", continuous_a, 20.0)
        _append_series(tasks, rng, "continuous-c", "workspace-continuous-c", continuous_c, 15.0, priority_probability=0.15)
        _append_series(tasks, rng, "returning", "workspace-returning", returning, 12.0)
    else:
        elephant_arrivals = [rng.uniform(0.0, 10.0) for _ in range(30)]
        _append_series(tasks, rng, "elephant", "workspace-elephant", elephant_arrivals, 70.0)
        for workspace_index in range(3):
            arrivals = [rng.uniform(0.0, 10.0) for _ in range(50)]
            _append_series(tasks, rng, f"mice-{workspace_index}", f"workspace-mice-{workspace_index}", arrivals, 5.0, priority_probability=0.15)
    rng.shuffle(tasks)
    return tuple(tasks)


def _stress_service_share_error(results: Sequence[TaskScheduleResult], workspace_count: int, start_seconds: float, end_seconds: float) -> float:
    service: dict[str, float] = {}
    for result in results:
        overlap = max(0.0, min(result.completed_at_seconds, end_seconds) - max(result.started_at_seconds, start_seconds))
        service[result.workspace_id] = service.get(result.workspace_id, 0.0) + overlap
    total = sum(service.values())
    if total <= 0:
        return 0.0
    equal_share = 1 / workspace_count
    return max(abs(value / total - equal_share) for value in service.values())


def evaluate_tenant_fairness_policy(tasks: Sequence[SchedulerTask], scenario: TenantFairnessScenario, policy: SchedulingPolicy, seed: int, config: TenantFairnessConfig) -> TenantFairnessRow:
    result = simulate_scheduler(tasks, policy, worker_count=config.worker_count, max_wait_seconds=config.max_wait_seconds, high_priority_rescue_seconds=config.high_priority_rescue_seconds, high_priority_reserved_workers=config.high_priority_reserved_workers)
    workspace_p95 = [metric.p95_wait_seconds for metric in result.workspace_metrics]
    high_priority = [task for task in result.task_results if task.priority >= 4]
    high_priority_violation_rate = 0.0 if not high_priority else sum(task.queue_wait_seconds > config.high_priority_wait_seconds for task in high_priority) / len(high_priority)
    completion_slo_rate = sum(task.completion_time_seconds <= config.completion_slo_seconds for task in result.task_results) / len(result.task_results)
    worst_workspace_p95 = max(workspace_p95)
    p95_disparity = worst_workspace_p95 / max(median(workspace_p95), 1.0)
    service_share_error = _stress_service_share_error(result.task_results, len(result.workspace_metrics), config.stress_window_start_seconds, config.stress_window_end_seconds)
    passed_gate = worst_workspace_p95 <= 300.0 and result.metrics.maximum_wait_seconds <= 600.0 and result.metrics.fairness_index >= 0.90 and completion_slo_rate >= 0.95 and high_priority_violation_rate <= 0.05 and service_share_error <= 0.20
    return TenantFairnessRow(seed=seed, scenario=scenario, policy=policy, mean_completion_seconds=result.metrics.mean_completion_seconds, p95_wait_seconds=result.metrics.p95_wait_seconds, maximum_wait_seconds=result.metrics.maximum_wait_seconds, worst_workspace_p95_wait_seconds=worst_workspace_p95, workspace_p95_disparity=p95_disparity, fairness_index=result.metrics.fairness_index, completion_slo_rate=completion_slo_rate, high_priority_violation_rate=high_priority_violation_rate, stress_service_share_error=service_share_error, passed_gate=passed_gate)


def _summary(rows: Sequence[TenantFairnessRow], policy: SchedulingPolicy) -> TenantFairnessSummary:
    selected = [row for row in rows if row.policy is policy]
    return TenantFairnessSummary(policy=policy, mean_completion_seconds=_estimate([row.mean_completion_seconds for row in selected]), p95_wait_seconds=_estimate([row.p95_wait_seconds for row in selected]), maximum_wait_seconds=_estimate([row.maximum_wait_seconds for row in selected]), worst_workspace_p95_wait_seconds=_estimate([row.worst_workspace_p95_wait_seconds for row in selected]), workspace_p95_disparity=_estimate([row.workspace_p95_disparity for row in selected]), fairness_index=_estimate([row.fairness_index for row in selected]), completion_slo_rate=_estimate([row.completion_slo_rate for row in selected]), high_priority_violation_rate=_estimate([row.high_priority_violation_rate for row in selected]), stress_service_share_error=_estimate([row.stress_service_share_error for row in selected]), gate_pass_rate=sum(row.passed_gate for row in selected) / len(selected))


def run_tenant_fairness_benchmark(*, config: TenantFairnessConfig | None = None, seeds: Sequence[int] = (11, 23, 37, 42, 59), scenarios: Sequence[TenantFairnessScenario] = tuple(TenantFairnessScenario), policies: Sequence[SchedulingPolicy] = TENANT_FAIRNESS_POLICIES) -> TenantFairnessBenchmark:
    if not seeds or not scenarios or not policies:
        raise ValueError("seeds, scenarios and policies must not be empty")
    selected_config = config or TenantFairnessConfig()
    rows: list[TenantFairnessRow] = []
    for scenario in scenarios:
        for seed in seeds:
            tasks = generate_tenant_fairness_workload(scenario, seed=seed)
            rows.extend(evaluate_tenant_fairness_policy(tasks, scenario, policy, seed, selected_config) for policy in policies)
    summaries = tuple(_summary(rows, policy) for policy in policies)
    fully_eligible = [summary for summary in summaries if summary.gate_pass_rate == 1.0]
    selected_policy = min(fully_eligible, key=lambda summary: summary.mean_completion_seconds.mean).policy if fully_eligible else None
    return TenantFairnessBenchmark(config=selected_config, rows=tuple(rows), summaries=summaries, selected_policy=selected_policy)
