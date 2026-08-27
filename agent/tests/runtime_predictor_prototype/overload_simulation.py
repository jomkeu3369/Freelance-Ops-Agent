from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from statistics import mean

from .scheduler_simulation import MetricEstimate, SchedulerExperimentConfig, SchedulerTask, SchedulingPolicy, SimulationResult, WorkerCapacityEvent, _estimate, _jain_index, _percentile, generate_scheduler_workload, simulate_scheduler


class AdmissionPolicy(StrEnum):
    ACCEPT_ALL = "accept_all"
    BOUNDED_DEFER = "bounded_defer"
    PRIORITY_SHED = "priority_shed"
    HYBRID_GUARD = "hybrid_guard"


class AdmissionDecision(StrEnum):
    ADMIT = "admit"
    DEFER = "defer"
    REJECT = "reject"


ADMISSION_LABELS = {AdmissionPolicy.ACCEPT_ALL: "Accept all", AdmissionPolicy.BOUNDED_DEFER: "Bounded defer", AdmissionPolicy.PRIORITY_SHED: "Priority shed", AdmissionPolicy.HYBRID_GUARD: "Hybrid guard"}


@dataclass(frozen=True, slots=True)
class AdmissionConfig:
    max_active_drain_seconds: float = 120.0
    max_defer_seconds: float = 600.0
    emergency_drain_seconds: float = 300.0
    high_priority_threshold: int = 4
    low_priority_threshold: int = 2
    completion_slo_seconds: float = 300.0

    def __post_init__(self) -> None:
        if self.max_active_drain_seconds <= 0 or self.max_defer_seconds <= 0 or self.emergency_drain_seconds <= 0 or self.completion_slo_seconds <= 0:
            raise ValueError("admission timing values must be positive")
        if self.emergency_drain_seconds < self.max_active_drain_seconds:
            raise ValueError("emergency drain must not be smaller than active drain")
        if not 1 <= self.low_priority_threshold < self.high_priority_threshold <= 5:
            raise ValueError("priority thresholds must be ordered within [1, 5]")


@dataclass(frozen=True, slots=True)
class AdmissionOutcome:
    task: SchedulerTask
    decision: AdmissionDecision
    admitted_at_seconds: float | None
    predicted_drain_seconds: float

    @property
    def admission_delay_seconds(self) -> float:
        return 0.0 if self.admitted_at_seconds is None else self.admitted_at_seconds - self.task.queued_at_seconds


@dataclass(frozen=True, slots=True)
class AdmissionPolicyEvent:
    at_seconds: float
    policy: AdmissionPolicy

    def __post_init__(self) -> None:
        if self.at_seconds < 0:
            raise ValueError("admission policy event time must be non-negative")


@dataclass(frozen=True, slots=True)
class AdmissionRunMetrics:
    admitted_rate: float
    deferred_rate: float
    rejected_rate: float
    high_priority_acceptance_rate: float
    low_priority_acceptance_rate: float
    workspace_acceptance_fairness: float
    mean_end_to_end_seconds: float
    p95_end_to_end_seconds: float
    p99_end_to_end_seconds: float
    maximum_end_to_end_seconds: float
    p95_admission_delay_seconds: float
    completion_slo_rate: float
    recovery_after_last_arrival_seconds: float
    accepted_predicted_work_ratio: float
    worker_capacity_seconds: float
    slo_tasks_per_1000_worker_seconds: float


@dataclass(frozen=True, slots=True)
class AdmissionSimulationResult:
    policy: AdmissionPolicy
    scheduler_policy: SchedulingPolicy
    outcomes: tuple[AdmissionOutcome, ...]
    scheduler_result: SimulationResult
    metrics: AdmissionRunMetrics


@dataclass(frozen=True, slots=True)
class AdmissionBenchmarkRow:
    seed: int
    policy: AdmissionPolicy
    metrics: AdmissionRunMetrics


@dataclass(frozen=True, slots=True)
class AdmissionBenchmarkSummary:
    policy: AdmissionPolicy
    admitted_rate: MetricEstimate
    deferred_rate: MetricEstimate
    rejected_rate: MetricEstimate
    high_priority_acceptance_rate: MetricEstimate
    low_priority_acceptance_rate: MetricEstimate
    workspace_acceptance_fairness: MetricEstimate
    mean_end_to_end_seconds: MetricEstimate
    p95_end_to_end_seconds: MetricEstimate
    p99_end_to_end_seconds: MetricEstimate
    maximum_end_to_end_seconds: MetricEstimate
    p95_admission_delay_seconds: MetricEstimate
    completion_slo_rate: MetricEstimate
    recovery_after_last_arrival_seconds: MetricEstimate
    accepted_predicted_work_ratio: MetricEstimate
    worker_capacity_seconds: MetricEstimate
    slo_tasks_per_1000_worker_seconds: MetricEstimate


@dataclass(frozen=True, slots=True)
class AdmissionBenchmark:
    config: SchedulerExperimentConfig
    admission_config: AdmissionConfig
    scheduler_policy: SchedulingPolicy
    rows: tuple[AdmissionBenchmarkRow, ...]
    summaries: tuple[AdmissionBenchmarkSummary, ...]
    offered_load_ratio: MetricEstimate


def _admission_decision(task: SchedulerTask, policy: AdmissionPolicy, projected_drain_seconds: float, defer_seconds: float, config: AdmissionConfig) -> AdmissionDecision:
    if task.cache_hit or policy is AdmissionPolicy.ACCEPT_ALL or projected_drain_seconds <= config.max_active_drain_seconds:
        return AdmissionDecision.ADMIT
    if policy is AdmissionPolicy.BOUNDED_DEFER:
        return AdmissionDecision.DEFER if defer_seconds <= config.max_defer_seconds else AdmissionDecision.REJECT
    if policy is AdmissionPolicy.PRIORITY_SHED:
        protected = task.priority >= config.high_priority_threshold and projected_drain_seconds <= config.emergency_drain_seconds
        return AdmissionDecision.ADMIT if protected else AdmissionDecision.REJECT
    if task.priority <= config.low_priority_threshold:
        return AdmissionDecision.REJECT
    within_emergency_limit = projected_drain_seconds <= config.emergency_drain_seconds
    return AdmissionDecision.DEFER if within_emergency_limit and defer_seconds <= config.max_defer_seconds else AdmissionDecision.REJECT


def _worker_count_at(at_seconds: float, worker_count: int, capacity_events: Sequence[WorkerCapacityEvent]) -> int:
    current = worker_count
    for event in sorted(capacity_events, key=lambda item: item.at_seconds):
        if event.at_seconds > at_seconds:
            break
        current = event.worker_count
    return current


def _admission_policy_at(at_seconds: float, initial_policy: AdmissionPolicy, policy_events: Sequence[AdmissionPolicyEvent]) -> AdmissionPolicy:
    current = initial_policy
    for event in sorted(policy_events, key=lambda item: item.at_seconds):
        if event.at_seconds > at_seconds:
            break
        current = event.policy
    return current


def worker_capacity_between(start_seconds: float, end_seconds: float, worker_count: int, capacity_events: Sequence[WorkerCapacityEvent]) -> float:
    if end_seconds < start_seconds:
        raise ValueError("capacity interval end must not be before start")
    current_time = start_seconds
    current_workers = _worker_count_at(start_seconds, worker_count, capacity_events)
    capacity = 0.0
    for event in sorted(capacity_events, key=lambda item: item.at_seconds):
        if event.at_seconds <= start_seconds:
            continue
        if event.at_seconds >= end_seconds:
            break
        capacity += current_workers * (event.at_seconds - current_time)
        current_time = event.at_seconds
        current_workers = event.worker_count
    return capacity + current_workers * (end_seconds - current_time)


def apply_admission_policy(tasks: Sequence[SchedulerTask], policy: AdmissionPolicy, worker_count: int, config: AdmissionConfig, *, capacity_events: Sequence[WorkerCapacityEvent] = (), policy_events: Sequence[AdmissionPolicyEvent] = ()) -> tuple[AdmissionOutcome, ...]:
    if not tasks or worker_count < 1:
        raise ValueError("tasks must not be empty and worker_count must be positive")
    ordered = sorted(tasks, key=lambda task: (task.queued_at_seconds, task.task_id))
    predicted_backlog_work = 0.0
    previous_arrival = ordered[0].queued_at_seconds
    outcomes: list[AdmissionOutcome] = []
    for task in ordered:
        available_capacity = worker_capacity_between(previous_arrival, task.queued_at_seconds, worker_count, capacity_events)
        predicted_backlog_work = max(0.0, predicted_backlog_work - available_capacity)
        current_worker_count = _worker_count_at(task.queued_at_seconds, worker_count, capacity_events)
        predicted_work = 0.0 if task.cache_hit else task.predicted_runtime_seconds
        projected_work = predicted_backlog_work + predicted_work
        projected_drain_seconds = projected_work / current_worker_count
        defer_seconds = max(0.0, projected_drain_seconds - config.max_active_drain_seconds)
        active_policy = _admission_policy_at(task.queued_at_seconds, policy, policy_events)
        decision = _admission_decision(task, active_policy, projected_drain_seconds, defer_seconds, config)
        admitted_at = None if decision is AdmissionDecision.REJECT else task.queued_at_seconds + (defer_seconds if decision is AdmissionDecision.DEFER else 0.0)
        outcomes.append(AdmissionOutcome(task=task, decision=decision, admitted_at_seconds=admitted_at, predicted_drain_seconds=projected_drain_seconds))
        if decision is not AdmissionDecision.REJECT:
            predicted_backlog_work = projected_work
        previous_arrival = task.queued_at_seconds
    return tuple(outcomes)


def _acceptance_rate(outcomes: Sequence[AdmissionOutcome], predicate: Callable[[SchedulerTask], bool]) -> float:
    selected = [outcome for outcome in outcomes if predicate(outcome.task)]
    return 1.0 if not selected else sum(outcome.decision is not AdmissionDecision.REJECT for outcome in selected) / len(selected)


def _workspace_acceptance_fairness(outcomes: Sequence[AdmissionOutcome]) -> float:
    grouped: dict[str, list[AdmissionOutcome]] = defaultdict(list)
    for outcome in outcomes:
        grouped[outcome.task.workspace_id].append(outcome)
    rates = [sum(outcome.decision is not AdmissionDecision.REJECT for outcome in workspace_outcomes) / len(workspace_outcomes) for workspace_outcomes in grouped.values()]
    return _jain_index(rates)


def simulate_admission_policy(tasks: Sequence[SchedulerTask], admission_policy: AdmissionPolicy, *, worker_count: int, scheduler_policy: SchedulingPolicy = SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING, admission_config: AdmissionConfig | None = None, max_wait_seconds: float = 120.0, aging_rate: float = 0.02, aging_overdue_interval: int = 4, capacity_events: Sequence[WorkerCapacityEvent] = (), policy_events: Sequence[AdmissionPolicyEvent] = ()) -> AdmissionSimulationResult:
    config = admission_config or AdmissionConfig()
    outcomes = apply_admission_policy(tasks, admission_policy, worker_count, config, capacity_events=capacity_events, policy_events=policy_events)
    admitted = [outcome for outcome in outcomes if outcome.decision is not AdmissionDecision.REJECT]
    if not admitted:
        raise ValueError("admission policy rejected every task")
    admitted_tasks = [replace(outcome.task, queued_at_seconds=float(outcome.admitted_at_seconds)) for outcome in admitted]
    scheduler_result = simulate_scheduler(admitted_tasks, scheduler_policy, worker_count=worker_count, max_wait_seconds=max_wait_seconds, aging_rate=aging_rate, aging_overdue_interval=aging_overdue_interval, capacity_events=capacity_events)
    original_arrivals = {outcome.task.task_id: outcome.task.queued_at_seconds for outcome in admitted}
    end_to_end = [result.completed_at_seconds - original_arrivals[result.task_id] for result in scheduler_result.task_results]
    admission_delays = [outcome.admission_delay_seconds for outcome in admitted]
    total_count = len(outcomes)
    admitted_count = len(admitted)
    deferred_count = sum(outcome.decision is AdmissionDecision.DEFER for outcome in outcomes)
    rejected_count = total_count - admitted_count
    last_arrival = max(outcome.task.queued_at_seconds for outcome in outcomes)
    last_completion = max(result.completed_at_seconds for result in scheduler_result.task_results)
    first_arrival = min(outcome.task.queued_at_seconds for outcome in outcomes)
    total_predicted_work = sum(outcome.task.predicted_runtime_seconds for outcome in outcomes if not outcome.task.cache_hit)
    accepted_predicted_work = sum(outcome.task.predicted_runtime_seconds for outcome in admitted if not outcome.task.cache_hit)
    completion_slo_count = sum(value <= config.completion_slo_seconds for value in end_to_end)
    worker_capacity_seconds = worker_capacity_between(first_arrival, last_completion, worker_count, capacity_events)
    metrics = AdmissionRunMetrics(admitted_rate=admitted_count / total_count, deferred_rate=deferred_count / total_count, rejected_rate=rejected_count / total_count, high_priority_acceptance_rate=_acceptance_rate(outcomes, lambda task: task.priority >= config.high_priority_threshold), low_priority_acceptance_rate=_acceptance_rate(outcomes, lambda task: task.priority <= config.low_priority_threshold), workspace_acceptance_fairness=_workspace_acceptance_fairness(outcomes), mean_end_to_end_seconds=mean(end_to_end), p95_end_to_end_seconds=_percentile(end_to_end, 95), p99_end_to_end_seconds=_percentile(end_to_end, 99), maximum_end_to_end_seconds=max(end_to_end), p95_admission_delay_seconds=_percentile(admission_delays, 95), completion_slo_rate=completion_slo_count / total_count, recovery_after_last_arrival_seconds=max(0.0, last_completion - last_arrival), accepted_predicted_work_ratio=1.0 if total_predicted_work == 0 else accepted_predicted_work / total_predicted_work, worker_capacity_seconds=worker_capacity_seconds, slo_tasks_per_1000_worker_seconds=0.0 if worker_capacity_seconds == 0 else 1_000 * completion_slo_count / worker_capacity_seconds)
    return AdmissionSimulationResult(policy=admission_policy, scheduler_policy=scheduler_policy, outcomes=outcomes, scheduler_result=scheduler_result, metrics=metrics)


def _summarize_admission(rows: Sequence[AdmissionBenchmarkRow], policy: AdmissionPolicy) -> AdmissionBenchmarkSummary:
    selected = [row.metrics for row in rows if row.policy is policy]
    return AdmissionBenchmarkSummary(policy=policy, admitted_rate=_estimate([metrics.admitted_rate for metrics in selected]), deferred_rate=_estimate([metrics.deferred_rate for metrics in selected]), rejected_rate=_estimate([metrics.rejected_rate for metrics in selected]), high_priority_acceptance_rate=_estimate([metrics.high_priority_acceptance_rate for metrics in selected]), low_priority_acceptance_rate=_estimate([metrics.low_priority_acceptance_rate for metrics in selected]), workspace_acceptance_fairness=_estimate([metrics.workspace_acceptance_fairness for metrics in selected]), mean_end_to_end_seconds=_estimate([metrics.mean_end_to_end_seconds for metrics in selected]), p95_end_to_end_seconds=_estimate([metrics.p95_end_to_end_seconds for metrics in selected]), p99_end_to_end_seconds=_estimate([metrics.p99_end_to_end_seconds for metrics in selected]), maximum_end_to_end_seconds=_estimate([metrics.maximum_end_to_end_seconds for metrics in selected]), p95_admission_delay_seconds=_estimate([metrics.p95_admission_delay_seconds for metrics in selected]), completion_slo_rate=_estimate([metrics.completion_slo_rate for metrics in selected]), recovery_after_last_arrival_seconds=_estimate([metrics.recovery_after_last_arrival_seconds for metrics in selected]), accepted_predicted_work_ratio=_estimate([metrics.accepted_predicted_work_ratio for metrics in selected]), worker_capacity_seconds=_estimate([metrics.worker_capacity_seconds for metrics in selected]), slo_tasks_per_1000_worker_seconds=_estimate([metrics.slo_tasks_per_1000_worker_seconds for metrics in selected]))


def run_admission_benchmark(config: SchedulerExperimentConfig, *, admission_config: AdmissionConfig | None = None, scheduler_policy: SchedulingPolicy = SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING, seeds: Sequence[int] = (11, 23, 37, 42, 59)) -> AdmissionBenchmark:
    if not seeds:
        raise ValueError("seeds must not be empty")
    selected_config = admission_config or AdmissionConfig()
    rows: list[AdmissionBenchmarkRow] = []
    loads: list[float] = []
    for seed in seeds:
        tasks, prediction_metrics = generate_scheduler_workload(config, random_seed=seed)
        loads.append(prediction_metrics[3])
        for policy in AdmissionPolicy:
            result = simulate_admission_policy(tasks, policy, worker_count=config.worker_count, scheduler_policy=scheduler_policy, admission_config=selected_config, max_wait_seconds=config.max_wait_seconds, aging_rate=config.aging_rate, aging_overdue_interval=config.aging_overdue_interval)
            rows.append(AdmissionBenchmarkRow(seed=seed, policy=policy, metrics=result.metrics))
    summaries = tuple(_summarize_admission(rows, policy) for policy in AdmissionPolicy)
    return AdmissionBenchmark(config=config, admission_config=selected_config, scheduler_policy=scheduler_policy, rows=tuple(rows), summaries=summaries, offered_load_ratio=_estimate(loads))
