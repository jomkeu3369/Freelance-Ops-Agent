from __future__ import annotations

import math
import random
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from heapq import heappop, heappush
from statistics import mean, pstdev

from .prototype import ModelKind, RuntimePredictor, generate_synthetic_history, regression_metrics


class SchedulingPolicy(StrEnum):
    FIFO = "fifo"
    GLOBAL_PREDICTED_SJF = "global_predicted_sjf"
    GLOBAL_PREDICTED_SJF_AGING = "global_predicted_sjf_aging"
    SLO_AWARE_PREDICTED_SJF = "slo_aware_predicted_sjf"
    FAIR_FIFO = "fair_fifo"
    FAIR_PREDICTED_SJF = "fair_predicted_sjf"
    FAIR_PREDICTED_SJF_AGING = "fair_predicted_sjf_aging"
    BOUNDED_FAIR_PREDICTED_SJF_AGING = "bounded_fair_predicted_sjf_aging"
    ORACLE_SJF = "oracle_sjf"


POLICY_LABELS = {
    SchedulingPolicy.FIFO: "FIFO",
    SchedulingPolicy.GLOBAL_PREDICTED_SJF: "Global Predicted-SJF",
    SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING: "Global Predicted-SJF + Aging",
    SchedulingPolicy.SLO_AWARE_PREDICTED_SJF: "SLO-aware Predicted-SJF",
    SchedulingPolicy.FAIR_FIFO: "Fair FIFO",
    SchedulingPolicy.FAIR_PREDICTED_SJF: "Fair Predicted-SJF",
    SchedulingPolicy.FAIR_PREDICTED_SJF_AGING: "Fair Predicted-SJF + Aging",
    SchedulingPolicy.BOUNDED_FAIR_PREDICTED_SJF_AGING: "Bounded Fair PSJF + Aging",
    SchedulingPolicy.ORACLE_SJF: "Oracle-SJF"
}


FAIR_POLICIES = frozenset((SchedulingPolicy.FAIR_FIFO, SchedulingPolicy.FAIR_PREDICTED_SJF, SchedulingPolicy.FAIR_PREDICTED_SJF_AGING, SchedulingPolicy.BOUNDED_FAIR_PREDICTED_SJF_AGING))
AGING_POLICIES = frozenset((SchedulingPolicy.GLOBAL_PREDICTED_SJF_AGING, SchedulingPolicy.SLO_AWARE_PREDICTED_SJF, SchedulingPolicy.FAIR_PREDICTED_SJF_AGING, SchedulingPolicy.BOUNDED_FAIR_PREDICTED_SJF_AGING))
BOUNDED_FAIR_POLICIES = frozenset([SchedulingPolicy.BOUNDED_FAIR_PREDICTED_SJF_AGING])
SLO_AWARE_POLICIES = frozenset([SchedulingPolicy.SLO_AWARE_PREDICTED_SJF])


@dataclass(frozen=True, slots=True)
class SchedulerTask:
    task_id: str
    workspace_id: str
    queued_at_seconds: float
    actual_runtime_seconds: float
    predicted_runtime_seconds: float
    priority: int = 3
    workspace_weight: float = 1.0
    cache_hit: bool = False
    cache_lookup_seconds: float = 0.02

    def __post_init__(self) -> None:
        if not self.task_id.strip() or not self.workspace_id.strip():
            raise ValueError("task_id and workspace_id must not be blank")
        if self.queued_at_seconds < 0:
            raise ValueError("queued_at_seconds must be non-negative")
        if self.actual_runtime_seconds <= 0 or self.predicted_runtime_seconds <= 0:
            raise ValueError("runtime values must be positive")
        if not 1 <= self.priority <= 5:
            raise ValueError("priority must be between one and five")
        if self.workspace_weight <= 0 or self.cache_lookup_seconds <= 0:
            raise ValueError("workspace weight and cache lookup time must be positive")

    @property
    def service_runtime_seconds(self) -> float:
        return self.cache_lookup_seconds if self.cache_hit else self.actual_runtime_seconds


@dataclass(frozen=True, slots=True)
class WorkerCapacityEvent:
    at_seconds: float
    worker_count: int

    def __post_init__(self) -> None:
        if self.at_seconds < 0 or self.worker_count < 1:
            raise ValueError("capacity event time must be non-negative and worker count must be positive")


@dataclass(frozen=True, slots=True)
class TaskScheduleResult:
    task_id: str
    workspace_id: str
    queued_at_seconds: float
    started_at_seconds: float
    completed_at_seconds: float
    actual_runtime_seconds: float
    predicted_runtime_seconds: float
    priority: int
    cache_hit: bool

    @property
    def queue_wait_seconds(self) -> float:
        return self.started_at_seconds - self.queued_at_seconds

    @property
    def completion_time_seconds(self) -> float:
        return self.completed_at_seconds - self.queued_at_seconds

    @property
    def slowdown(self) -> float:
        return self.completion_time_seconds / self.actual_runtime_seconds


@dataclass(frozen=True, slots=True)
class WorkspaceMetrics:
    workspace_id: str
    task_count: int
    mean_wait_seconds: float
    p95_wait_seconds: float
    mean_completion_seconds: float
    mean_slowdown: float


@dataclass(frozen=True, slots=True)
class SimulationMetrics:
    mean_wait_seconds: float
    p95_wait_seconds: float
    mean_completion_seconds: float
    p95_completion_seconds: float
    makespan_seconds: float
    fairness_index: float
    starvation_count: int
    maximum_wait_seconds: float
    cache_hit_count: int
    scheduler_regret_percent: float = 0.0


@dataclass(frozen=True, slots=True)
class SimulationResult:
    policy: SchedulingPolicy
    task_results: tuple[TaskScheduleResult, ...]
    workspace_metrics: tuple[WorkspaceMetrics, ...]
    metrics: SimulationMetrics


@dataclass(frozen=True, slots=True)
class SchedulerExperimentConfig:
    workspace_count: int = 6
    tasks_per_workspace: int = 80
    worker_count: int = 6
    mean_interarrival_seconds: float = 25.0
    burst_workspace_multiplier: float = 3.0
    latency_drift: float = 0.3
    prediction_noise: float = 0.0
    cache_hit_rate: float = 0.1
    max_wait_seconds: float = 120.0
    aging_rate: float = 0.02
    aging_overdue_interval: int = 4
    training_samples: int = 2_000

    def __post_init__(self) -> None:
        if self.workspace_count < 1 or self.tasks_per_workspace < 1 or self.worker_count < 1:
            raise ValueError("workspace, task and worker counts must be positive")
        if self.mean_interarrival_seconds <= 0 or self.burst_workspace_multiplier < 1:
            raise ValueError("arrival interval must be positive and burst multiplier must be at least one")
        if self.latency_drift < 0 or self.prediction_noise < 0:
            raise ValueError("drift and prediction noise must be non-negative")
        if not 0 <= self.cache_hit_rate < 1:
            raise ValueError("cache_hit_rate must be in the interval [0, 1)")
        if self.max_wait_seconds <= 0 or self.aging_rate < 0:
            raise ValueError("max wait must be positive and aging rate must be non-negative")
        if self.aging_overdue_interval < 1:
            raise ValueError("aging_overdue_interval must be positive")
        if self.training_samples < 100:
            raise ValueError("training_samples must be at least 100")


@dataclass(frozen=True, slots=True)
class BenchmarkRow:
    seed: int
    policy: SchedulingPolicy
    metrics: SimulationMetrics


@dataclass(frozen=True, slots=True)
class MetricEstimate:
    mean: float
    ci95: float


@dataclass(frozen=True, slots=True)
class PolicyBenchmarkSummary:
    policy: SchedulingPolicy
    mean_wait_seconds: MetricEstimate
    p95_wait_seconds: MetricEstimate
    mean_completion_seconds: MetricEstimate
    fairness_index: MetricEstimate
    starvation_count: MetricEstimate
    maximum_wait_seconds: MetricEstimate
    scheduler_regret_percent: MetricEstimate


@dataclass(frozen=True, slots=True)
class SchedulerBenchmark:
    rows: tuple[BenchmarkRow, ...]
    summaries: tuple[PolicyBenchmarkSummary, ...]
    prediction_mae_seconds: MetricEstimate
    prediction_rmse_seconds: MetricEstimate
    prediction_r2: MetricEstimate
    offered_load_ratio: MetricEstimate


def _percentile(values: Sequence[float], percentile: float) -> float:
    if not values:
        raise ValueError("values must not be empty")
    if not 0 <= percentile <= 100:
        raise ValueError("percentile must be between zero and one hundred")
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile / 100
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return float(ordered[lower])
    fraction = position - lower
    return float(ordered[lower] * (1 - fraction) + ordered[upper] * fraction)


def _jain_index(values: Sequence[float]) -> float:
    if not values:
        raise ValueError("values must not be empty")
    squared_sum = sum(values) ** 2
    square_sum = sum(value**2 for value in values)
    return 1.0 if square_sum == 0 else squared_sum / (len(values) * square_sum)


def _estimate(values: Sequence[float]) -> MetricEstimate:
    if not values:
        raise ValueError("values must not be empty")
    average = mean(values)
    ci95 = 0.0 if len(values) == 1 else 1.96 * pstdev(values) / math.sqrt(len(values))
    return MetricEstimate(mean=float(average), ci95=float(ci95))


def _workspace_choice(ready: Sequence[SchedulerTask], virtual_service: dict[str, float]) -> str:
    by_workspace: dict[str, list[SchedulerTask]] = defaultdict(list)
    for task in ready:
        by_workspace[task.workspace_id].append(task)
    return min(by_workspace, key=lambda workspace_id: (virtual_service[workspace_id], min(task.queued_at_seconds for task in by_workspace[workspace_id]), workspace_id))


def _active_workspace_ids(ready: Sequence[SchedulerTask], running: Sequence[tuple[float, int, SchedulerTask, float]]) -> set[str]:
    return {task.workspace_id for task in ready} | {task.workspace_id for _, _, task, _ in running}


def _task_choice(ready: Sequence[SchedulerTask], policy: SchedulingPolicy, current_time: float, max_wait_seconds: float, aging_rate: float, aging_overdue_interval: int, workspace_dispatch_count: int) -> SchedulerTask:
    if policy is SchedulingPolicy.FIFO:
        return min(ready, key=lambda task: (task.queued_at_seconds, task.task_id))
    if policy is SchedulingPolicy.FAIR_FIFO:
        return min(ready, key=lambda task: (-task.priority, task.queued_at_seconds, task.task_id))
    if policy is SchedulingPolicy.ORACLE_SJF:
        return min(ready, key=lambda task: (task.actual_runtime_seconds / (1 + 0.25 * (task.priority - 1)), task.queued_at_seconds, task.task_id))
    if policy in AGING_POLICIES:
        overdue = [task for task in ready if current_time - task.queued_at_seconds >= max_wait_seconds]
        if overdue and workspace_dispatch_count % aging_overdue_interval == aging_overdue_interval - 1:
            return min(overdue, key=lambda task: (task.queued_at_seconds, -task.priority, task.task_id))
        return min(ready, key=lambda task: (task.predicted_runtime_seconds / (1 + 0.25 * (task.priority - 1) + aging_rate * max(0.0, current_time - task.queued_at_seconds)), task.queued_at_seconds, task.task_id))
    return min(ready, key=lambda task: (task.predicted_runtime_seconds / (1 + 0.25 * (task.priority - 1)), task.queued_at_seconds, task.task_id))


def simulate_scheduler(tasks: Sequence[SchedulerTask], policy: SchedulingPolicy, *, worker_count: int = 4, max_wait_seconds: float = 120.0, aging_rate: float = 0.02, aging_overdue_interval: int = 4, fair_idle_credit_seconds: float = 10.0, high_priority_rescue_seconds: float = 45.0, high_priority_reserved_workers: int = 0, capacity_events: Sequence[WorkerCapacityEvent] = ()) -> SimulationResult:
    if not tasks:
        raise ValueError("tasks must not be empty")
    if worker_count < 1 or max_wait_seconds <= 0 or aging_rate < 0 or aging_overdue_interval < 1 or fair_idle_credit_seconds < 0 or high_priority_rescue_seconds < 0 or not 0 <= high_priority_reserved_workers < worker_count:
        raise ValueError("worker count and max wait must be positive and aging rate must be non-negative")
    task_ids = [task.task_id for task in tasks]
    if len(task_ids) != len(set(task_ids)):
        raise ValueError("task_id values must be unique")
    ordered_capacity_events = sorted(capacity_events, key=lambda event: event.at_seconds)
    if len({event.at_seconds for event in ordered_capacity_events}) != len(ordered_capacity_events):
        raise ValueError("capacity event times must be unique")

    arrivals = sorted((task for task in tasks if not task.cache_hit), key=lambda task: (task.queued_at_seconds, task.task_id))
    completed: list[TaskScheduleResult] = [TaskScheduleResult(task_id=task.task_id, workspace_id=task.workspace_id, queued_at_seconds=task.queued_at_seconds, started_at_seconds=task.queued_at_seconds, completed_at_seconds=task.queued_at_seconds + task.cache_lookup_seconds, actual_runtime_seconds=task.cache_lookup_seconds, predicted_runtime_seconds=task.cache_lookup_seconds, priority=task.priority, cache_hit=True) for task in tasks if task.cache_hit]
    ready: list[SchedulerTask] = []
    running: list[tuple[float, int, SchedulerTask, float]] = []
    virtual_service: dict[str, float] = defaultdict(float)
    priority_virtual_service: dict[str, float] = defaultdict(float)
    minimum_virtual_service = 0.0
    workspace_dispatch_counts: dict[str, int] = defaultdict(int)
    arrival_index = 0
    worker_serial = 0
    capacity_index = 0
    current_worker_count = worker_count
    current_time = min(task.queued_at_seconds for task in tasks)

    while arrival_index < len(arrivals) or ready or running:
        while capacity_index < len(ordered_capacity_events) and ordered_capacity_events[capacity_index].at_seconds <= current_time:
            current_worker_count = ordered_capacity_events[capacity_index].worker_count
            capacity_index += 1
        while running and running[0][0] <= current_time:
            completed_at, _, task, started_at = heappop(running)
            completed.append(TaskScheduleResult(task_id=task.task_id, workspace_id=task.workspace_id, queued_at_seconds=task.queued_at_seconds, started_at_seconds=started_at, completed_at_seconds=completed_at, actual_runtime_seconds=task.actual_runtime_seconds, predicted_runtime_seconds=task.predicted_runtime_seconds, priority=task.priority, cache_hit=False))
        active_before_arrivals = _active_workspace_ids(ready, running)
        if policy in BOUNDED_FAIR_POLICIES and active_before_arrivals:
            minimum_virtual_service = max(minimum_virtual_service, min(virtual_service[workspace_id] for workspace_id in active_before_arrivals))
        while arrival_index < len(arrivals) and arrivals[arrival_index].queued_at_seconds <= current_time:
            arriving = arrivals[arrival_index]
            if policy in BOUNDED_FAIR_POLICIES and arriving.workspace_id not in active_before_arrivals:
                virtual_service[arriving.workspace_id] = max(virtual_service[arriving.workspace_id], minimum_virtual_service - fair_idle_credit_seconds / arriving.workspace_weight)
                active_before_arrivals.add(arriving.workspace_id)
            ready.append(arriving)
            arrival_index += 1

        while ready and len(running) < current_worker_count:
            priority_ready = any(task.priority >= 4 for task in ready)
            effective_reserved_workers = min(high_priority_reserved_workers, current_worker_count - 1)
            normal_worker_limit = current_worker_count - effective_reserved_workers
            low_priority_running = sum(task.priority < 4 for _, _, task, _ in running)
            if policy in SLO_AWARE_POLICIES and not priority_ready and low_priority_running >= normal_worker_limit:
                break
            global_dispatch_count = workspace_dispatch_counts["__global__"]
            global_overdue = [task for task in ready if current_time - task.queued_at_seconds >= max_wait_seconds]
            high_priority_overdue = [task for task in ready if task.priority >= 4 and current_time - task.queued_at_seconds >= high_priority_rescue_seconds]
            if policy in SLO_AWARE_POLICIES and high_priority_overdue:
                priority_workspace = min({task.workspace_id for task in high_priority_overdue}, key=lambda workspace_id: (priority_virtual_service[workspace_id], min(task.queued_at_seconds for task in high_priority_overdue if task.workspace_id == workspace_id), workspace_id))
                selected = min((task for task in high_priority_overdue if task.workspace_id == priority_workspace), key=lambda task: (task.predicted_runtime_seconds, -task.priority, task.queued_at_seconds, task.task_id))
                scheduling_scope = "__global__"
            elif policy in BOUNDED_FAIR_POLICIES and global_overdue and global_dispatch_count % aging_overdue_interval == aging_overdue_interval - 1:
                selected = min(global_overdue, key=lambda task: (task.queued_at_seconds, -task.priority, task.task_id))
                scheduling_scope = selected.workspace_id
            elif policy not in FAIR_POLICIES:
                eligible = ready
                scheduling_scope = "__global__"
                workspace_dispatch_count = workspace_dispatch_counts[scheduling_scope]
                selected = _task_choice(eligible, policy, current_time, max_wait_seconds, aging_rate, aging_overdue_interval, workspace_dispatch_count)
            else:
                workspace_id = _workspace_choice(ready, virtual_service)
                eligible = [task for task in ready if task.workspace_id == workspace_id]
                scheduling_scope = workspace_id
                workspace_dispatch_count = workspace_dispatch_counts[scheduling_scope]
                selected = _task_choice(eligible, policy, current_time, max_wait_seconds, aging_rate, aging_overdue_interval, workspace_dispatch_count)
            ready.remove(selected)
            finish_time = current_time + selected.actual_runtime_seconds
            heappush(running, (finish_time, worker_serial, selected, current_time))
            worker_serial += 1
            workspace_dispatch_counts[scheduling_scope] += 1
            if scheduling_scope != "__global__":
                workspace_dispatch_counts["__global__"] += 1
            if policy in SLO_AWARE_POLICIES and selected.priority >= 4:
                priority_virtual_service[selected.workspace_id] += selected.predicted_runtime_seconds / selected.workspace_weight
            if policy in FAIR_POLICIES:
                accounting_runtime = selected.predicted_runtime_seconds
                virtual_service[selected.workspace_id] += accounting_runtime / selected.workspace_weight
                if policy in BOUNDED_FAIR_POLICIES:
                    active_workspaces = _active_workspace_ids(ready, running)
                    minimum_virtual_service = max(minimum_virtual_service, min(virtual_service[workspace_id] for workspace_id in active_workspaces))

        if arrival_index >= len(arrivals) and not running and not ready:
            break
        candidates: list[float] = []
        if arrival_index < len(arrivals):
            candidates.append(arrivals[arrival_index].queued_at_seconds)
        if running:
            candidates.append(running[0][0])
        if capacity_index < len(ordered_capacity_events):
            candidates.append(ordered_capacity_events[capacity_index].at_seconds)
        if candidates:
            future = [candidate for candidate in candidates if candidate > current_time]
            current_time = min(future) if future else current_time

    ordered_results = tuple(sorted(completed, key=lambda result: (result.completed_at_seconds, result.task_id)))
    workspace_metrics = _workspace_metrics(ordered_results)
    metrics = _simulation_metrics(ordered_results, workspace_metrics, max_wait_seconds)
    return SimulationResult(policy=policy, task_results=ordered_results, workspace_metrics=workspace_metrics, metrics=metrics)


def _workspace_metrics(results: Sequence[TaskScheduleResult]) -> tuple[WorkspaceMetrics, ...]:
    grouped: dict[str, list[TaskScheduleResult]] = defaultdict(list)
    for result in results:
        grouped[result.workspace_id].append(result)
    metrics: list[WorkspaceMetrics] = []
    for workspace_id in sorted(grouped):
        workspace_results = grouped[workspace_id]
        waits = [result.queue_wait_seconds for result in workspace_results]
        completions = [result.completion_time_seconds for result in workspace_results]
        slowdowns = [result.slowdown for result in workspace_results]
        metrics.append(WorkspaceMetrics(workspace_id=workspace_id, task_count=len(workspace_results), mean_wait_seconds=mean(waits), p95_wait_seconds=_percentile(waits, 95), mean_completion_seconds=mean(completions), mean_slowdown=mean(slowdowns)))
    return tuple(metrics)


def _simulation_metrics(results: Sequence[TaskScheduleResult], workspace_metrics: Sequence[WorkspaceMetrics], max_wait_seconds: float) -> SimulationMetrics:
    waits = [result.queue_wait_seconds for result in results]
    completions = [result.completion_time_seconds for result in results]
    inverse_slowdowns = [1 / max(metric.mean_slowdown, 1e-9) for metric in workspace_metrics]
    makespan = max(result.completed_at_seconds for result in results) - min(result.queued_at_seconds for result in results)
    return SimulationMetrics(mean_wait_seconds=mean(waits), p95_wait_seconds=_percentile(waits, 95), mean_completion_seconds=mean(completions), p95_completion_seconds=_percentile(completions, 95), makespan_seconds=makespan, fairness_index=_jain_index(inverse_slowdowns), starvation_count=sum(wait > max_wait_seconds for wait in waits), maximum_wait_seconds=max(waits), cache_hit_count=sum(result.cache_hit for result in results))


def generate_scheduler_workload(config: SchedulerExperimentConfig, *, random_seed: int = 42) -> tuple[list[SchedulerTask], tuple[float, float, float, float]]:
    rng = random.Random(random_seed)
    training = generate_synthetic_history(config.training_samples, random_seed=random_seed)
    predictor = RuntimePredictor(ModelKind.XGBOOST, random_seed=random_seed).fit(training)
    sample_count = config.workspace_count * config.tasks_per_workspace
    validation = generate_synthetic_history(sample_count, random_seed=random_seed + 10_000, latency_drift=config.latency_drift)
    predictions = [predictor.predict(record.task) for record in validation]
    actual = [record.runtime_seconds for record in validation]
    prediction_metrics = regression_metrics(actual, predictions)
    workspace_arrivals = [0.0] * config.workspace_count
    tasks: list[SchedulerTask] = []

    for index, record in enumerate(validation):
        workspace_index = index % config.workspace_count
        workspace_id = f"workspace-{workspace_index + 1:02d}"
        interval = config.mean_interarrival_seconds / config.burst_workspace_multiplier if workspace_index == 0 else config.mean_interarrival_seconds
        workspace_arrivals[workspace_index] += rng.expovariate(1 / interval)
        noisy_prediction = predictions[index] * math.exp(rng.gauss(0.0, config.prediction_noise))
        priority = rng.choices((1, 2, 3, 4, 5), weights=(0.05, 0.15, 0.55, 0.20, 0.05), k=1)[0]
        cache_hit = rng.random() < config.cache_hit_rate
        tasks.append(SchedulerTask(task_id=f"scheduler-{random_seed}-{index:05d}", workspace_id=workspace_id, queued_at_seconds=workspace_arrivals[workspace_index], actual_runtime_seconds=record.runtime_seconds, predicted_runtime_seconds=max(0.01, noisy_prediction), priority=priority, cache_hit=cache_hit))

    rng.shuffle(tasks)
    arrival_span = max(task.queued_at_seconds for task in tasks) - min(task.queued_at_seconds for task in tasks)
    service_demand = sum(task.actual_runtime_seconds for task in tasks if not task.cache_hit)
    offered_load_ratio = service_demand / (config.worker_count * max(arrival_span, 0.01))
    return tasks, (prediction_metrics.mae_seconds, prediction_metrics.rmse_seconds, prediction_metrics.r2, offered_load_ratio)


def run_policy_comparison(tasks: Sequence[SchedulerTask], *, worker_count: int = 4, max_wait_seconds: float = 120.0, aging_rate: float = 0.02, aging_overdue_interval: int = 4) -> dict[SchedulingPolicy, SimulationResult]:
    results = {policy: simulate_scheduler(tasks, policy, worker_count=worker_count, max_wait_seconds=max_wait_seconds, aging_rate=aging_rate, aging_overdue_interval=aging_overdue_interval) for policy in SchedulingPolicy}
    oracle_completion = results[SchedulingPolicy.ORACLE_SJF].metrics.mean_completion_seconds
    for policy, result in tuple(results.items()):
        regret = 100 * (result.metrics.mean_completion_seconds - oracle_completion) / oracle_completion
        results[policy] = replace(result, metrics=replace(result.metrics, scheduler_regret_percent=regret))
    return results


def run_scheduler_benchmark(config: SchedulerExperimentConfig, *, seeds: Sequence[int] = (11, 23, 37, 42, 59)) -> SchedulerBenchmark:
    if not seeds:
        raise ValueError("seeds must not be empty")
    rows: list[BenchmarkRow] = []
    prediction_metrics: list[tuple[float, float, float]] = []
    for seed in seeds:
        tasks, metrics = generate_scheduler_workload(config, random_seed=seed)
        prediction_metrics.append(metrics)
        comparisons = run_policy_comparison(tasks, worker_count=config.worker_count, max_wait_seconds=config.max_wait_seconds, aging_rate=config.aging_rate, aging_overdue_interval=config.aging_overdue_interval)
        rows.extend(BenchmarkRow(seed=seed, policy=policy, metrics=result.metrics) for policy, result in comparisons.items())
    summaries: list[PolicyBenchmarkSummary] = []
    for policy in SchedulingPolicy:
        policy_metrics = [row.metrics for row in rows if row.policy is policy]
        summaries.append(PolicyBenchmarkSummary(policy=policy, mean_wait_seconds=_estimate([metric.mean_wait_seconds for metric in policy_metrics]), p95_wait_seconds=_estimate([metric.p95_wait_seconds for metric in policy_metrics]), mean_completion_seconds=_estimate([metric.mean_completion_seconds for metric in policy_metrics]), fairness_index=_estimate([metric.fairness_index for metric in policy_metrics]), starvation_count=_estimate([float(metric.starvation_count) for metric in policy_metrics]), maximum_wait_seconds=_estimate([metric.maximum_wait_seconds for metric in policy_metrics]), scheduler_regret_percent=_estimate([metric.scheduler_regret_percent for metric in policy_metrics])))
    return SchedulerBenchmark(rows=tuple(rows), summaries=tuple(summaries), prediction_mae_seconds=_estimate([metrics[0] for metrics in prediction_metrics]), prediction_rmse_seconds=_estimate([metrics[1] for metrics in prediction_metrics]), prediction_r2=_estimate([metrics[2] for metrics in prediction_metrics]), offered_load_ratio=_estimate([metrics[3] for metrics in prediction_metrics]))
