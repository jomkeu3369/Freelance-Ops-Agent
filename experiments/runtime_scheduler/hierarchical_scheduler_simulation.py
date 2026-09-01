from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from statistics import mean

from .overload_simulation import AdmissionDecision, worker_capacity_between
from .scheduler_simulation import MetricEstimate, SchedulerTask, SchedulingPolicy, TaskScheduleResult, WorkerCapacityEvent, _estimate, _jain_index, _percentile, simulate_scheduler
from .tenant_fairness_simulation import TenantFairnessScenario, generate_tenant_fairness_workload


class HierarchicalStrategy(StrEnum):
    ACCEPT_ALL = "accept_all"
    GLOBAL_GUARD = "global_guard"
    WORKSPACE_QUOTA = "workspace_quota"
    HIERARCHICAL_STATIC = "hierarchical_static"
    HIERARCHICAL_SCALE = "hierarchical_scale"


HIERARCHICAL_LABELS = {HierarchicalStrategy.ACCEPT_ALL: "Accept all + Global PSJF", HierarchicalStrategy.GLOBAL_GUARD: "Global backlog guard", HierarchicalStrategy.WORKSPACE_QUOTA: "Workspace quota", HierarchicalStrategy.HIERARCHICAL_STATIC: "Hierarchical static", HierarchicalStrategy.HIERARCHICAL_SCALE: "Hierarchical + scale"}


@dataclass(frozen=True, slots=True)
class HierarchicalConfig:
    worker_count: int = 6
    global_drain_limit_seconds: float = 120.0
    emergency_drain_limit_seconds: float = 300.0
    workspace_burst_work_seconds: float = 240.0
    maximum_defer_seconds: float = 120.0
    priority_wait_slo_seconds: float = 60.0
    completion_slo_seconds: float = 300.0
    high_priority_threshold: int = 4
    low_priority_threshold: int = 2
    scale_factor: float = 2.0
    scale_delay_seconds: float = 30.0
    scale_hard_deadline_seconds: float = 60.0

    def __post_init__(self) -> None:
        timing = (self.global_drain_limit_seconds, self.emergency_drain_limit_seconds, self.workspace_burst_work_seconds, self.maximum_defer_seconds, self.priority_wait_slo_seconds, self.completion_slo_seconds)
        if self.worker_count < 1 or min(timing) <= 0:
            raise ValueError("worker count and timing values must be positive")
        if self.emergency_drain_limit_seconds < self.global_drain_limit_seconds:
            raise ValueError("emergency drain limit must not be smaller than global limit")
        if not 1 <= self.low_priority_threshold < self.high_priority_threshold <= 5:
            raise ValueError("priority thresholds are invalid")
        if self.scale_factor <= 1 or self.scale_delay_seconds < 0 or self.scale_hard_deadline_seconds < self.scale_delay_seconds:
            raise ValueError("scale factor, delay and hard deadline are invalid")


@dataclass(frozen=True, slots=True)
class HierarchicalAdmissionOutcome:
    task: SchedulerTask
    decision: AdmissionDecision
    admitted_at_seconds: float | None
    global_drain_seconds: float
    workspace_defer_seconds: float
    priority_drain_seconds: float
    priority_infeasible: bool
    workspace_guarded: bool


@dataclass(frozen=True, slots=True)
class HierarchicalMetrics:
    admitted_rate: float
    deferred_rate: float
    rejected_rate: float
    high_priority_acceptance_rate: float
    workspace_acceptance_fairness: float
    mean_end_to_end_seconds: float
    p95_end_to_end_seconds: float
    maximum_wait_seconds: float
    completion_slo_goodput: float
    high_priority_wait_slo_goodput: float
    worst_workspace_completion_goodput: float
    slowdown_fairness_index: float
    priority_infeasible_rate: float
    workspace_guard_rate: float
    worker_capacity_seconds: float
    slo_tasks_per_1000_worker_seconds: float


@dataclass(frozen=True, slots=True)
class HierarchicalRun:
    seed: int
    scenario: TenantFairnessScenario
    strategy: HierarchicalStrategy
    outcomes: tuple[HierarchicalAdmissionOutcome, ...]
    task_results: tuple[TaskScheduleResult, ...]
    metrics: HierarchicalMetrics
    capacity_events: tuple[WorkerCapacityEvent, ...]


@dataclass(frozen=True, slots=True)
class HierarchicalSummary:
    strategy: HierarchicalStrategy
    admitted_rate: MetricEstimate
    rejected_rate: MetricEstimate
    high_priority_acceptance_rate: MetricEstimate
    workspace_acceptance_fairness: MetricEstimate
    mean_end_to_end_seconds: MetricEstimate
    p95_end_to_end_seconds: MetricEstimate
    maximum_wait_seconds: MetricEstimate
    completion_slo_goodput: MetricEstimate
    high_priority_wait_slo_goodput: MetricEstimate
    worst_workspace_completion_goodput: MetricEstimate
    slowdown_fairness_index: MetricEstimate
    priority_infeasible_rate: MetricEstimate
    workspace_guard_rate: MetricEstimate
    worker_capacity_seconds: MetricEstimate
    slo_tasks_per_1000_worker_seconds: MetricEstimate
    scale_activation_rate: float
    hard_gate_pass_rate: float


@dataclass(frozen=True, slots=True)
class HierarchicalBenchmark:
    config: HierarchicalConfig
    rows: tuple[HierarchicalRun, ...]
    summaries: tuple[HierarchicalSummary, ...]
    selected_strategy: HierarchicalStrategy | None


def _capacity_at(at_seconds: float, worker_count: int, capacity_events: Sequence[WorkerCapacityEvent]) -> int:
    current = worker_count
    for event in capacity_events:
        if event.at_seconds > at_seconds:
            break
        current = event.worker_count
    return current


def _admission_decision(task: SchedulerTask, strategy: HierarchicalStrategy, global_delay_seconds: float, workspace_delay_seconds: float, priority_infeasible: bool, scale_resolves_global: bool, config: HierarchicalConfig) -> tuple[AdmissionDecision, float]:
    if task.cache_hit or strategy is HierarchicalStrategy.ACCEPT_ALL:
        return AdmissionDecision.ADMIT, 0.0
    if strategy is HierarchicalStrategy.GLOBAL_GUARD:
        if global_delay_seconds <= 0:
            return AdmissionDecision.ADMIT, 0.0
        if task.priority >= config.high_priority_threshold and not priority_infeasible:
            return AdmissionDecision.ADMIT, 0.0
        if task.priority <= config.low_priority_threshold:
            return AdmissionDecision.REJECT, 0.0
        return (AdmissionDecision.DEFER, global_delay_seconds) if global_delay_seconds <= config.maximum_defer_seconds else (AdmissionDecision.REJECT, 0.0)
    if strategy is HierarchicalStrategy.WORKSPACE_QUOTA:
        if workspace_delay_seconds <= 0:
            return AdmissionDecision.ADMIT, 0.0
        if task.priority <= config.low_priority_threshold:
            return AdmissionDecision.REJECT, 0.0
        return (AdmissionDecision.DEFER, workspace_delay_seconds) if workspace_delay_seconds <= config.maximum_defer_seconds else (AdmissionDecision.REJECT, 0.0)
    if task.priority >= config.high_priority_threshold:
        return AdmissionDecision.ADMIT, 0.0
    if global_delay_seconds <= 0 and not priority_infeasible:
        return AdmissionDecision.ADMIT, 0.0
    combined_delay = max(global_delay_seconds, workspace_delay_seconds)
    if strategy is HierarchicalStrategy.HIERARCHICAL_SCALE and scale_resolves_global:
        combined_delay = 0.0
    if combined_delay <= 0:
        return AdmissionDecision.ADMIT, 0.0
    if task.priority <= config.low_priority_threshold:
        return AdmissionDecision.REJECT, 0.0
    return (AdmissionDecision.DEFER, combined_delay) if combined_delay <= config.maximum_defer_seconds else (AdmissionDecision.REJECT, 0.0)


def apply_hierarchical_admission(tasks: Sequence[SchedulerTask], strategy: HierarchicalStrategy, config: HierarchicalConfig, *, scale_succeeds: bool = True, failure_fallback: HierarchicalStrategy | None = None) -> tuple[tuple[HierarchicalAdmissionOutcome, ...], tuple[WorkerCapacityEvent, ...]]:
    if not tasks:
        raise ValueError("tasks must not be empty")
    if failure_fallback is HierarchicalStrategy.HIERARCHICAL_SCALE:
        raise ValueError("failure fallback must not request the same scaling strategy")
    ordered = sorted(tasks, key=lambda task: (task.queued_at_seconds, task.task_id))
    workspace_count = len({task.workspace_id for task in ordered})
    workspace_backlog: dict[str, float] = defaultdict(float)
    workspace_last_arrival: dict[str, float] = {}
    global_backlog = 0.0
    priority_backlog = 0.0
    previous_arrival = ordered[0].queued_at_seconds
    scale_event: WorkerCapacityEvent | None = None
    scale_requested_at: float | None = None
    outcomes: list[HierarchicalAdmissionOutcome] = []
    for task in ordered:
        capacity_events = () if scale_event is None else tuple([scale_event])
        available_capacity = worker_capacity_between(previous_arrival, task.queued_at_seconds, config.worker_count, capacity_events)
        global_backlog = max(0.0, global_backlog - available_capacity)
        priority_backlog = max(0.0, priority_backlog - available_capacity)
        last_workspace_arrival = workspace_last_arrival.get(task.workspace_id, task.queued_at_seconds)
        workspace_capacity = worker_capacity_between(last_workspace_arrival, task.queued_at_seconds, config.worker_count, capacity_events) / workspace_count
        workspace_backlog[task.workspace_id] = max(0.0, workspace_backlog[task.workspace_id] - workspace_capacity)
        current_workers = _capacity_at(task.queued_at_seconds, config.worker_count, capacity_events)
        predicted_work = 0.0 if task.cache_hit else task.predicted_runtime_seconds
        projected_global = global_backlog + predicted_work
        projected_workspace = workspace_backlog[task.workspace_id] + predicted_work
        projected_priority = priority_backlog + predicted_work if task.priority >= config.high_priority_threshold else priority_backlog
        global_drain = projected_global / current_workers
        global_delay = max(0.0, global_drain - config.global_drain_limit_seconds)
        workspace_refill_rate = current_workers / workspace_count
        workspace_delay = max(0.0, (projected_workspace - config.workspace_burst_work_seconds) / workspace_refill_rate)
        priority_drain = projected_priority / current_workers
        priority_infeasible = task.priority >= config.high_priority_threshold and priority_drain > config.priority_wait_slo_seconds
        overload = global_drain > config.global_drain_limit_seconds or priority_infeasible
        if strategy is HierarchicalStrategy.HIERARCHICAL_SCALE and overload and scale_requested_at is None:
            scale_requested_at = task.queued_at_seconds
            scaled_workers = max(config.worker_count + 1, round(config.worker_count * config.scale_factor))
            if scale_succeeds:
                scale_event = WorkerCapacityEvent(at_seconds=task.queued_at_seconds + config.scale_delay_seconds, worker_count=scaled_workers)
                capacity_events = tuple([scale_event])
        fallback_at = None if scale_requested_at is None else scale_requested_at + config.scale_hard_deadline_seconds
        fallback_active = not scale_succeeds and fallback_at is not None and task.queued_at_seconds >= fallback_at
        active_strategy = failure_fallback if fallback_active and failure_fallback is not None else HierarchicalStrategy.ACCEPT_ALL if fallback_active else strategy
        planned_scaled_workers = max(config.worker_count + 1, round(config.worker_count * config.scale_factor))
        scale_capacity_expected = scale_requested_at is not None and (scale_succeeds or not fallback_active)
        future_workers = planned_scaled_workers if scale_capacity_expected else config.worker_count
        future_global_drain = projected_global / future_workers
        scale_resolves_global = scale_capacity_expected and future_global_drain <= config.emergency_drain_limit_seconds
        decision, defer_seconds = _admission_decision(task, active_strategy, global_delay, workspace_delay, priority_infeasible, scale_resolves_global, config)
        admitted_at = None if decision is AdmissionDecision.REJECT else task.queued_at_seconds + defer_seconds
        outcomes.append(HierarchicalAdmissionOutcome(task=task, decision=decision, admitted_at_seconds=admitted_at, global_drain_seconds=global_drain, workspace_defer_seconds=workspace_delay, priority_drain_seconds=priority_drain, priority_infeasible=priority_infeasible, workspace_guarded=workspace_delay > 0))
        if decision is not AdmissionDecision.REJECT:
            global_backlog = projected_global
            workspace_backlog[task.workspace_id] = projected_workspace
            if task.priority >= config.high_priority_threshold:
                priority_backlog = projected_priority
        workspace_last_arrival[task.workspace_id] = task.queued_at_seconds
        previous_arrival = task.queued_at_seconds
    return tuple(outcomes), () if scale_event is None else tuple([scale_event])


def _acceptance_rate(outcomes: Sequence[HierarchicalAdmissionOutcome], *, priority_threshold: int) -> float:
    selected = [outcome for outcome in outcomes if outcome.task.priority >= priority_threshold]
    return 1.0 if not selected else sum(outcome.decision is not AdmissionDecision.REJECT for outcome in selected) / len(selected)


def _acceptance_fairness(outcomes: Sequence[HierarchicalAdmissionOutcome]) -> float:
    grouped: dict[str, list[HierarchicalAdmissionOutcome]] = defaultdict(list)
    for outcome in outcomes:
        grouped[outcome.task.workspace_id].append(outcome)
    rates = [sum(outcome.decision is not AdmissionDecision.REJECT for outcome in selected) / len(selected) for selected in grouped.values()]
    return _jain_index(rates)


def _workspace_completion_goodput(outcomes: Sequence[HierarchicalAdmissionOutcome], results: dict[str, TaskScheduleResult], completion_slo_seconds: float) -> float:
    grouped: dict[str, list[HierarchicalAdmissionOutcome]] = defaultdict(list)
    for outcome in outcomes:
        grouped[outcome.task.workspace_id].append(outcome)
    rates: list[float] = []
    for selected in grouped.values():
        completed = sum(outcome.task.task_id in results and results[outcome.task.task_id].completed_at_seconds - outcome.task.queued_at_seconds <= completion_slo_seconds for outcome in selected)
        rates.append(completed / len(selected))
    return min(rates)


def simulate_hierarchical_strategy(tasks: Sequence[SchedulerTask], strategy: HierarchicalStrategy, *, seed: int, scenario: TenantFairnessScenario, config: HierarchicalConfig | None = None, scale_succeeds: bool = True, failure_fallback: HierarchicalStrategy | None = None) -> HierarchicalRun:
    selected_config = config or HierarchicalConfig()
    outcomes, capacity_events = apply_hierarchical_admission(tasks, strategy, selected_config, scale_succeeds=scale_succeeds, failure_fallback=failure_fallback)
    admitted = [outcome for outcome in outcomes if outcome.decision is not AdmissionDecision.REJECT]
    if not admitted:
        raise ValueError("strategy rejected every task")
    admitted_tasks = [replace(outcome.task, queued_at_seconds=float(outcome.admitted_at_seconds)) for outcome in admitted]
    scheduler_policy = SchedulingPolicy.SLO_AWARE_PREDICTED_SJF if strategy in (HierarchicalStrategy.HIERARCHICAL_STATIC, HierarchicalStrategy.HIERARCHICAL_SCALE) else SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING
    if strategy is HierarchicalStrategy.HIERARCHICAL_SCALE and not scale_succeeds and failure_fallback is not None:
        _, planned_events = apply_hierarchical_admission(tasks, strategy, selected_config, scale_succeeds=True)
        if planned_events:
            fallback_at = planned_events[0].at_seconds - selected_config.scale_delay_seconds + selected_config.scale_hard_deadline_seconds
            preliminary = simulate_scheduler(admitted_tasks, scheduler_policy, worker_count=selected_config.worker_count, max_wait_seconds=selected_config.global_drain_limit_seconds, high_priority_rescue_seconds=0.0)
            queued_at_fallback = {result.task_id for result in preliminary.task_results if result.started_at_seconds >= fallback_at}
            fallback_outcomes, _ = apply_hierarchical_admission(tasks, failure_fallback, selected_config)
            fallback_by_id = {outcome.task.task_id: outcome for outcome in fallback_outcomes}
            adjusted: list[HierarchicalAdmissionOutcome] = []
            for outcome in outcomes:
                if outcome.task.task_id not in queued_at_fallback:
                    adjusted.append(outcome)
                    continue
                fallback_outcome = fallback_by_id[outcome.task.task_id]
                admitted_at = None if fallback_outcome.decision is AdmissionDecision.REJECT else max(fallback_at, float(fallback_outcome.admitted_at_seconds))
                adjusted.append(replace(outcome, decision=fallback_outcome.decision, admitted_at_seconds=admitted_at))
            outcomes = tuple(adjusted)
            admitted = [outcome for outcome in outcomes if outcome.decision is not AdmissionDecision.REJECT]
            admitted_tasks = [replace(outcome.task, queued_at_seconds=float(outcome.admitted_at_seconds)) for outcome in admitted]
    scheduler_result = simulate_scheduler(admitted_tasks, scheduler_policy, worker_count=selected_config.worker_count, max_wait_seconds=selected_config.global_drain_limit_seconds, high_priority_rescue_seconds=0.0, capacity_events=capacity_events)
    results = {result.task_id: result for result in scheduler_result.task_results}
    end_to_end = [result.completed_at_seconds - next(outcome.task.queued_at_seconds for outcome in admitted if outcome.task.task_id == result.task_id) for result in scheduler_result.task_results]
    high_priority_outcomes = [outcome for outcome in outcomes if outcome.task.priority >= selected_config.high_priority_threshold]
    high_priority_slo_count = sum(outcome.task.task_id in results and results[outcome.task.task_id].started_at_seconds - outcome.task.queued_at_seconds <= selected_config.priority_wait_slo_seconds for outcome in high_priority_outcomes)
    completion_slo_count = sum(outcome.task.task_id in results and results[outcome.task.task_id].completed_at_seconds - outcome.task.queued_at_seconds <= selected_config.completion_slo_seconds for outcome in outcomes)
    first_arrival = min(outcome.task.queued_at_seconds for outcome in outcomes)
    last_completion = max(result.completed_at_seconds for result in scheduler_result.task_results)
    worker_capacity = worker_capacity_between(first_arrival, last_completion, selected_config.worker_count, capacity_events)
    total_count = len(outcomes)
    rejected_count = sum(outcome.decision is AdmissionDecision.REJECT for outcome in outcomes)
    deferred_count = sum(outcome.decision is AdmissionDecision.DEFER for outcome in outcomes)
    metrics = HierarchicalMetrics(admitted_rate=(total_count - rejected_count) / total_count, deferred_rate=deferred_count / total_count, rejected_rate=rejected_count / total_count, high_priority_acceptance_rate=_acceptance_rate(outcomes, priority_threshold=selected_config.high_priority_threshold), workspace_acceptance_fairness=_acceptance_fairness(outcomes), mean_end_to_end_seconds=mean(end_to_end), p95_end_to_end_seconds=_percentile(end_to_end, 95), maximum_wait_seconds=max(result.started_at_seconds - next(outcome.task.queued_at_seconds for outcome in admitted if outcome.task.task_id == result.task_id) for result in scheduler_result.task_results), completion_slo_goodput=completion_slo_count / total_count, high_priority_wait_slo_goodput=1.0 if not high_priority_outcomes else high_priority_slo_count / len(high_priority_outcomes), worst_workspace_completion_goodput=_workspace_completion_goodput(outcomes, results, selected_config.completion_slo_seconds), slowdown_fairness_index=scheduler_result.metrics.fairness_index, priority_infeasible_rate=sum(outcome.priority_infeasible for outcome in high_priority_outcomes) / max(1, len(high_priority_outcomes)), workspace_guard_rate=sum(outcome.workspace_guarded for outcome in outcomes) / total_count, worker_capacity_seconds=worker_capacity, slo_tasks_per_1000_worker_seconds=0.0 if worker_capacity == 0 else 1_000 * completion_slo_count / worker_capacity)
    return HierarchicalRun(seed=seed, scenario=scenario, strategy=strategy, outcomes=outcomes, task_results=scheduler_result.task_results, metrics=metrics, capacity_events=capacity_events)


def _summary(rows: Sequence[HierarchicalRun], strategy: HierarchicalStrategy) -> HierarchicalSummary:
    selected = [row for row in rows if row.strategy is strategy]
    metrics = [row.metrics for row in selected]
    passed = [metric.completion_slo_goodput >= 0.95 and metric.high_priority_wait_slo_goodput >= 0.95 and metric.worst_workspace_completion_goodput >= 0.90 and metric.workspace_acceptance_fairness >= 0.90 and metric.maximum_wait_seconds <= 300.0 for metric in metrics]
    return HierarchicalSummary(strategy=strategy, admitted_rate=_estimate([metric.admitted_rate for metric in metrics]), rejected_rate=_estimate([metric.rejected_rate for metric in metrics]), high_priority_acceptance_rate=_estimate([metric.high_priority_acceptance_rate for metric in metrics]), workspace_acceptance_fairness=_estimate([metric.workspace_acceptance_fairness for metric in metrics]), mean_end_to_end_seconds=_estimate([metric.mean_end_to_end_seconds for metric in metrics]), p95_end_to_end_seconds=_estimate([metric.p95_end_to_end_seconds for metric in metrics]), maximum_wait_seconds=_estimate([metric.maximum_wait_seconds for metric in metrics]), completion_slo_goodput=_estimate([metric.completion_slo_goodput for metric in metrics]), high_priority_wait_slo_goodput=_estimate([metric.high_priority_wait_slo_goodput for metric in metrics]), worst_workspace_completion_goodput=_estimate([metric.worst_workspace_completion_goodput for metric in metrics]), slowdown_fairness_index=_estimate([metric.slowdown_fairness_index for metric in metrics]), priority_infeasible_rate=_estimate([metric.priority_infeasible_rate for metric in metrics]), workspace_guard_rate=_estimate([metric.workspace_guard_rate for metric in metrics]), worker_capacity_seconds=_estimate([metric.worker_capacity_seconds for metric in metrics]), slo_tasks_per_1000_worker_seconds=_estimate([metric.slo_tasks_per_1000_worker_seconds for metric in metrics]), scale_activation_rate=sum(bool(row.capacity_events) for row in selected) / len(selected), hard_gate_pass_rate=sum(passed) / len(passed))


def run_hierarchical_benchmark(*, config: HierarchicalConfig | None = None, seeds: Sequence[int] = (11, 23, 37, 42, 59), scenarios: Sequence[TenantFairnessScenario] = tuple(TenantFairnessScenario), strategies: Sequence[HierarchicalStrategy] = tuple(HierarchicalStrategy)) -> HierarchicalBenchmark:
    if not seeds or not scenarios or not strategies:
        raise ValueError("seeds, scenarios and strategies must not be empty")
    selected_config = config or HierarchicalConfig()
    rows: list[HierarchicalRun] = []
    for scenario in scenarios:
        for seed in seeds:
            tasks = generate_tenant_fairness_workload(scenario, seed=seed)
            rows.extend(simulate_hierarchical_strategy(tasks, strategy, seed=seed, scenario=scenario, config=selected_config) for strategy in strategies)
    summaries = tuple(_summary(rows, strategy) for strategy in strategies)
    eligible = [summary for summary in summaries if summary.hard_gate_pass_rate == 1.0]
    selected_strategy = max(eligible, key=lambda summary: summary.slo_tasks_per_1000_worker_seconds.mean).strategy if eligible else None
    return HierarchicalBenchmark(config=selected_config, rows=tuple(rows), summaries=summaries, selected_strategy=selected_strategy)
