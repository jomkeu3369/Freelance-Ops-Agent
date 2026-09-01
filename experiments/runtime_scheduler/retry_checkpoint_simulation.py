from __future__ import annotations

import math
import random
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum

from .overload_simulation import worker_capacity_between
from .scheduler_simulation import MetricEstimate, SchedulerExperimentConfig, SchedulerTask, WorkerCapacityEvent, _estimate, _percentile, generate_scheduler_workload


class RetryStrategy(StrEnum):
    RESTART_IMMEDIATE = "restart_immediate"
    RESTART_BACKOFF = "restart_backoff"
    RESTART_BACKOFF_BUDGET = "restart_backoff_budget"
    CHECKPOINT_IMMEDIATE = "checkpoint_immediate"
    CHECKPOINT_BACKOFF = "checkpoint_backoff"
    CHECKPOINT_BACKOFF_BUDGET = "checkpoint_backoff_budget"


class RetryBudgetScope(StrEnum):
    GLOBAL = "global"
    WORKSPACE_TOKEN_BUCKET = "workspace_token_bucket"
    HIERARCHICAL_TOKEN_BUCKET = "hierarchical_token_bucket"
    HIERARCHICAL_PRIORITY_BORROW = "hierarchical_priority_borrow"


RETRY_LABELS = {RetryStrategy.RESTART_IMMEDIATE: "Restart immediate", RetryStrategy.RESTART_BACKOFF: "Restart + backoff", RetryStrategy.RESTART_BACKOFF_BUDGET: "Restart + backoff + budget", RetryStrategy.CHECKPOINT_IMMEDIATE: "Checkpoint immediate", RetryStrategy.CHECKPOINT_BACKOFF: "Checkpoint + backoff", RetryStrategy.CHECKPOINT_BACKOFF_BUDGET: "Checkpoint + backoff + budget"}
CHECKPOINT_STRATEGIES = frozenset((RetryStrategy.CHECKPOINT_IMMEDIATE, RetryStrategy.CHECKPOINT_BACKOFF, RetryStrategy.CHECKPOINT_BACKOFF_BUDGET))
BACKOFF_STRATEGIES = frozenset((RetryStrategy.RESTART_BACKOFF, RetryStrategy.RESTART_BACKOFF_BUDGET, RetryStrategy.CHECKPOINT_BACKOFF, RetryStrategy.CHECKPOINT_BACKOFF_BUDGET))
BUDGET_STRATEGIES = frozenset((RetryStrategy.RESTART_BACKOFF_BUDGET, RetryStrategy.CHECKPOINT_BACKOFF_BUDGET))


@dataclass(frozen=True, slots=True)
class RetryExperimentConfig:
    worker_count: int = 6
    failure_probability: float = 0.2
    max_attempts: int = 4
    checkpoint_interval_seconds: float = 30.0
    checkpoint_overhead_seconds: float = 1.0
    base_backoff_seconds: float = 30.0
    maximum_backoff_seconds: float = 180.0
    jitter_ratio: float = 0.5
    retry_budget_ratio: float = 0.35
    retry_budget_scope: RetryBudgetScope = RetryBudgetScope.GLOBAL
    global_retry_bucket_capacity: float = 24.0
    global_retry_refill_tokens_per_second: float = 0.20
    workspace_retry_bucket_capacity: float = 6.0
    workspace_retry_refill_tokens_per_second: float = 0.10
    workspace_priority_borrow_limit: float = 2.0
    failure_probability_by_workspace: tuple[tuple[str, float], ...] = ()
    completion_slo_seconds: float = 300.0
    max_wait_seconds: float = 120.0
    high_priority_rescue_seconds: float = 45.0
    high_priority_reserved_workers: int = 0
    aging_rate: float = 0.02
    outage_at_seconds: float | None = None
    outage_duration_seconds: float = 0.0
    retry_burst_window_seconds: float = 10.0
    worker_hour_cost: float = 0.12
    secondary_provider_after_seconds: float | None = None
    secondary_provider_until_seconds: float | None = None
    secondary_provider_latency_multiplier: float = 1.0
    secondary_provider_cost_multiplier: float = 1.0

    def __post_init__(self) -> None:
        if self.worker_count < 1 or self.max_attempts < 1 or not 0 <= self.high_priority_reserved_workers < self.worker_count:
            raise ValueError("worker count and max attempts must be positive")
        if not 0 <= self.failure_probability <= 1 or not 0 <= self.jitter_ratio <= 1:
            raise ValueError("failure probability and jitter ratio must be within [0, 1]")
        if self.checkpoint_interval_seconds <= 0 or self.checkpoint_overhead_seconds < 0:
            raise ValueError("checkpoint interval must be positive and overhead non-negative")
        if self.base_backoff_seconds < 0 or self.maximum_backoff_seconds < self.base_backoff_seconds:
            raise ValueError("backoff values must be non-negative and ordered")
        if self.retry_budget_ratio < 0 or self.completion_slo_seconds <= 0 or self.max_wait_seconds <= 0 or self.high_priority_rescue_seconds < 0:
            raise ValueError("retry budget and timing values are invalid")
        if self.global_retry_bucket_capacity < 1 or self.global_retry_refill_tokens_per_second < 0 or self.workspace_retry_bucket_capacity < 1 or self.workspace_retry_refill_tokens_per_second < 0 or self.workspace_priority_borrow_limit < 0:
            raise ValueError("workspace retry token bucket values are invalid")
        workspace_ids = [workspace_id for workspace_id, _ in self.failure_probability_by_workspace]
        if len(workspace_ids) != len(set(workspace_ids)) or any(not workspace_id or not 0 <= probability <= 1 for workspace_id, probability in self.failure_probability_by_workspace):
            raise ValueError("workspace failure probabilities are invalid")
        if self.aging_rate < 0 or self.outage_duration_seconds < 0 or self.retry_burst_window_seconds <= 0 or self.worker_hour_cost <= 0:
            raise ValueError("aging, outage, burst window and worker cost values are invalid")
        if self.outage_at_seconds is not None and self.outage_at_seconds < 0:
            raise ValueError("outage time must be non-negative")
        if self.secondary_provider_after_seconds is not None and self.secondary_provider_after_seconds < 0:
            raise ValueError("secondary provider start must be non-negative")
        if self.secondary_provider_until_seconds is not None and (self.secondary_provider_after_seconds is None or self.secondary_provider_until_seconds < self.secondary_provider_after_seconds):
            raise ValueError("secondary provider window is invalid")
        if self.secondary_provider_latency_multiplier < 1 or self.secondary_provider_cost_multiplier <= 0:
            raise ValueError("secondary provider multipliers are invalid")


@dataclass(slots=True)
class _TaskState:
    task: SchedulerTask
    status: str
    ready_at_seconds: float
    durable_progress_seconds: float = 0.0
    attempts: int = 0
    retries: int = 0
    completed_at_seconds: float | None = None
    terminal_at_seconds: float | None = None
    first_started_at_seconds: float | None = None
    retry_budget_exhausted: bool = False


@dataclass(frozen=True, slots=True)
class _ActiveAttempt:
    state: _TaskState
    started_at_seconds: float
    start_progress_seconds: float
    target_progress_seconds: float
    event_at_seconds: float
    will_fail: bool
    checkpoint_enabled: bool
    secondary_provider: bool
    provider_cost_multiplier: float


@dataclass(frozen=True, slots=True)
class RetryRunMetrics:
    completion_rate: float
    completion_slo_rate: float
    failed_rate: float
    p95_end_to_end_seconds: float
    recovery_after_disturbance_seconds: float
    service_demand_seconds: float
    demand_amplification: float
    secondary_provider_service_share: float
    provider_cost_index: float
    wasted_useful_seconds: float
    checkpoint_overhead_seconds: float
    checkpoint_saved_work_seconds: float
    retry_count: int
    retry_budget_exhaustion_rate: float
    peak_ready_queue: int
    peak_retry_release_count: int
    makespan_seconds: float
    billed_worker_seconds: float
    estimated_worker_cost: float


@dataclass(frozen=True, slots=True)
class RetryRun:
    seed: int
    strategy: RetryStrategy
    metrics: RetryRunMetrics
    task_results: tuple[RetryTaskResult, ...]
    capacity_events: tuple[WorkerCapacityEvent, ...]


@dataclass(frozen=True, slots=True)
class RetryTaskResult:
    task_id: str
    workspace_id: str
    priority: int
    queued_at_seconds: float
    first_started_at_seconds: float | None
    completed_at_seconds: float | None
    terminal_at_seconds: float
    status: str
    attempts: int
    retries: int
    retry_budget_exhausted: bool


@dataclass(frozen=True, slots=True)
class RetryWorkload:
    seed: int
    tasks: tuple[SchedulerTask, ...]
    offered_load_ratio: float


@dataclass(frozen=True, slots=True)
class RetrySummary:
    strategy: RetryStrategy
    completion_rate: MetricEstimate
    completion_slo_rate: MetricEstimate
    failed_rate: MetricEstimate
    p95_end_to_end_seconds: MetricEstimate
    recovery_after_disturbance_seconds: MetricEstimate
    service_demand_seconds: MetricEstimate
    demand_amplification: MetricEstimate
    secondary_provider_service_share: MetricEstimate
    provider_cost_index: MetricEstimate
    wasted_useful_seconds: MetricEstimate
    checkpoint_overhead_seconds: MetricEstimate
    checkpoint_saved_work_seconds: MetricEstimate
    retry_count: MetricEstimate
    retry_budget_exhaustion_rate: MetricEstimate
    peak_ready_queue: MetricEstimate
    peak_retry_release_count: MetricEstimate
    makespan_seconds: MetricEstimate
    billed_worker_seconds: MetricEstimate
    estimated_worker_cost: MetricEstimate


@dataclass(frozen=True, slots=True)
class RetryBenchmark:
    scheduler_config: SchedulerExperimentConfig
    retry_config: RetryExperimentConfig
    rows: tuple[RetryRun, ...]
    summaries: tuple[RetrySummary, ...]
    offered_load_ratio: MetricEstimate


def _checkpoint_count(start_progress: float, target_progress: float, total_service: float, interval: float) -> int:
    if target_progress <= start_progress:
        return 0
    first_index = math.floor(start_progress / interval) + 1
    last_boundary = min(target_progress, math.nextafter(total_service, 0.0))
    last_index = math.floor(last_boundary / interval)
    return max(0, last_index - first_index + 1)


def _wall_duration(start_progress: float, target_progress: float, total_service: float, config: RetryExperimentConfig, checkpoint_enabled: bool) -> float:
    useful_seconds = target_progress - start_progress
    if not checkpoint_enabled:
        return useful_seconds
    checkpoint_count = _checkpoint_count(start_progress, target_progress, total_service, config.checkpoint_interval_seconds)
    return useful_seconds + checkpoint_count * config.checkpoint_overhead_seconds


def _progress_after_wall(start_progress: float, elapsed_seconds: float, total_service: float, config: RetryExperimentConfig, checkpoint_enabled: bool) -> tuple[float, float, float]:
    if not checkpoint_enabled:
        progress = min(total_service, start_progress + elapsed_seconds)
        return progress, 0.0, 0.0
    progress = start_progress
    durable = start_progress
    checkpoint_overhead = 0.0
    remaining_wall = elapsed_seconds
    while progress < total_service and remaining_wall > 0:
        next_boundary = min(total_service, (math.floor(progress / config.checkpoint_interval_seconds) + 1) * config.checkpoint_interval_seconds)
        useful_to_boundary = next_boundary - progress
        if remaining_wall < useful_to_boundary:
            progress += remaining_wall
            return progress, durable, checkpoint_overhead
        progress = next_boundary
        remaining_wall -= useful_to_boundary
        if progress >= total_service:
            return progress, durable, checkpoint_overhead
        if remaining_wall < config.checkpoint_overhead_seconds:
            checkpoint_overhead += remaining_wall
            return progress, durable, checkpoint_overhead
        remaining_wall -= config.checkpoint_overhead_seconds
        checkpoint_overhead += config.checkpoint_overhead_seconds
        durable = progress
    return progress, durable, checkpoint_overhead


def _durable_progress(progress: float, total_service: float, config: RetryExperimentConfig, checkpoint_enabled: bool) -> float:
    if not checkpoint_enabled:
        return 0.0
    durable = math.floor(progress / config.checkpoint_interval_seconds) * config.checkpoint_interval_seconds
    return min(durable, math.nextafter(total_service, 0.0))


def _stable_rng(seed: int, task_id: str, attempt: int, purpose: str) -> random.Random:
    return random.Random(f"{seed}:{task_id}:{attempt}:{purpose}")


def _backoff_seconds(state: _TaskState, strategy: RetryStrategy, seed: int, config: RetryExperimentConfig) -> float:
    if strategy not in BACKOFF_STRATEGIES:
        return 0.0
    exponential = min(config.maximum_backoff_seconds, config.base_backoff_seconds * 2 ** max(0, state.attempts - 1))
    jitter = _stable_rng(seed, state.task.task_id, state.attempts, "backoff").uniform(0.0, exponential * config.jitter_ratio)
    return exponential + jitter


def _schedule_attempt(state: _TaskState, strategy: RetryStrategy, seed: int, current_time: float, config: RetryExperimentConfig) -> _ActiveAttempt:
    checkpoint_enabled = strategy in CHECKPOINT_STRATEGIES
    start_progress = state.durable_progress_seconds if checkpoint_enabled else 0.0
    remaining = state.task.actual_runtime_seconds - start_progress
    state.attempts += 1
    if state.first_started_at_seconds is None:
        state.first_started_at_seconds = current_time
    failure_rng = _stable_rng(seed, state.task.task_id, state.attempts, "failure")
    failure_probability = dict(config.failure_probability_by_workspace).get(state.task.workspace_id, config.failure_probability)
    will_fail = failure_rng.random() < failure_probability
    failure_fraction = failure_rng.uniform(0.15, 0.9)
    target_progress = start_progress + remaining * failure_fraction if will_fail else state.task.actual_runtime_seconds
    secondary_provider = config.secondary_provider_after_seconds is not None and current_time >= config.secondary_provider_after_seconds and (config.secondary_provider_until_seconds is None or current_time < config.secondary_provider_until_seconds)
    latency_multiplier = config.secondary_provider_latency_multiplier if secondary_provider else 1.0
    provider_cost_multiplier = config.secondary_provider_cost_multiplier if secondary_provider else 1.0
    duration = _wall_duration(start_progress, target_progress, state.task.actual_runtime_seconds, config, checkpoint_enabled) * latency_multiplier
    state.status = "running"
    return _ActiveAttempt(state=state, started_at_seconds=current_time, start_progress_seconds=start_progress, target_progress_seconds=target_progress, event_at_seconds=current_time + duration, will_fail=will_fail, checkpoint_enabled=checkpoint_enabled, secondary_provider=secondary_provider, provider_cost_multiplier=provider_cost_multiplier)


def _ready_choice(states: Sequence[_TaskState], current_time: float, config: RetryExperimentConfig) -> _TaskState:
    priority_rescue = [state for state in states if state.task.priority >= 4 and current_time - state.task.queued_at_seconds >= config.high_priority_rescue_seconds]
    if priority_rescue:
        return min(priority_rescue, key=lambda state: (state.ready_at_seconds, -state.task.priority, state.task.task_id))
    overdue = [state for state in states if current_time - state.ready_at_seconds >= config.max_wait_seconds]
    if overdue:
        return min(overdue, key=lambda state: (state.ready_at_seconds, -state.task.priority, state.task.task_id))
    def score(state: _TaskState) -> tuple[float, float, str]:
        remaining_ratio = max(0.0, 1 - state.durable_progress_seconds / state.task.actual_runtime_seconds)
        predicted_remaining = state.task.predicted_runtime_seconds * remaining_ratio
        denominator = 1 + 0.25 * (state.task.priority - 1) + config.aging_rate * max(0.0, current_time - state.ready_at_seconds)
        return predicted_remaining / denominator, state.ready_at_seconds, state.task.task_id
    return min(states, key=score)


def _peak_release_count(release_times: Sequence[float], window_seconds: float) -> int:
    ordered = sorted(release_times)
    peak = 0
    right = 0
    for left, start in enumerate(ordered):
        right = max(right, left)
        while right < len(ordered) and ordered[right] <= start + window_seconds:
            right += 1
        peak = max(peak, right - left)
    return peak


def simulate_retry_strategy(tasks: Sequence[SchedulerTask], strategy: RetryStrategy, *, seed: int, config: RetryExperimentConfig | None = None, capacity_events: Sequence[WorkerCapacityEvent] = ()) -> RetryRun:
    if not tasks:
        raise ValueError("tasks must not be empty")
    selected = config or RetryExperimentConfig()
    task_ids = [task.task_id for task in tasks]
    if len(task_ids) != len(set(task_ids)):
        raise ValueError("task ids must be unique")
    ordered_capacity_events = tuple(sorted(capacity_events, key=lambda event: event.at_seconds))
    if len({event.at_seconds for event in ordered_capacity_events}) != len(ordered_capacity_events) or any(event.worker_count < 1 for event in ordered_capacity_events):
        raise ValueError("capacity events must have unique times and positive worker counts")
    states = [_TaskState(task=task, status="waiting", ready_at_seconds=task.queued_at_seconds) for task in tasks]
    active: list[_ActiveAttempt] = []
    current_time = min(task.queued_at_seconds for task in tasks)
    first_arrival = current_time
    current_worker_count = selected.worker_count
    capacity_index = 0
    outage_start = selected.outage_at_seconds
    outage_end = None if outage_start is None else outage_start + selected.outage_duration_seconds
    outage_processed = outage_start is None
    retry_limit = math.floor(len([task for task in tasks if not task.cache_hit]) * selected.retry_budget_ratio)
    retry_count = 0
    retry_release_times: list[float] = []
    global_retry_tokens = selected.global_retry_bucket_capacity
    global_retry_refilled_at = current_time
    workspace_retry_tokens: dict[str, float] = {}
    workspace_retry_refilled_at: dict[str, float] = {}
    peak_ready_queue = 0
    service_demand = 0.0
    secondary_provider_service = 0.0
    provider_costed_service = 0.0
    wasted_useful = 0.0
    checkpoint_overhead = 0.0
    checkpoint_saved_work = 0.0

    def workspace_tokens_at(state: _TaskState, failed_at: float) -> tuple[float, float]:
        workspace_id = state.task.workspace_id
        previous_time = workspace_retry_refilled_at.get(workspace_id, failed_at)
        previous_tokens = workspace_retry_tokens.get(workspace_id, selected.workspace_retry_bucket_capacity)
        elapsed = max(0.0, failed_at - previous_time)
        tokens = min(selected.workspace_retry_bucket_capacity, previous_tokens + elapsed * selected.workspace_retry_refill_tokens_per_second)
        borrow_limit = selected.workspace_priority_borrow_limit if selected.retry_budget_scope is RetryBudgetScope.HIERARCHICAL_PRIORITY_BORROW and state.task.priority >= 4 else 0.0
        workspace_retry_tokens[workspace_id] = tokens
        workspace_retry_refilled_at[workspace_id] = failed_at
        return tokens, borrow_limit

    def fail_attempt(attempt: _ActiveAttempt, progress: float, durable: float, failed_at: float) -> None:
        nonlocal retry_count, wasted_useful, checkpoint_saved_work, global_retry_tokens, global_retry_refilled_at
        state = attempt.state
        lost_progress = progress - durable if attempt.checkpoint_enabled else progress - attempt.start_progress_seconds
        wasted_useful += max(0.0, lost_progress)
        if attempt.checkpoint_enabled:
            checkpoint_saved_work += max(0.0, durable - attempt.start_progress_seconds)
            state.durable_progress_seconds = durable
        else:
            state.durable_progress_seconds = 0.0
        elapsed = max(0.0, failed_at - global_retry_refilled_at)
        global_retry_tokens = min(selected.global_retry_bucket_capacity, global_retry_tokens + elapsed * selected.global_retry_refill_tokens_per_second)
        global_retry_refilled_at = failed_at
        workspace_tokens, borrow_limit = workspace_tokens_at(state, failed_at) if selected.retry_budget_scope is not RetryBudgetScope.GLOBAL else (1.0, 0.0)
        global_available = retry_count < retry_limit if selected.retry_budget_scope is RetryBudgetScope.GLOBAL else global_retry_tokens >= 1.0
        workspace_available = workspace_tokens + borrow_limit >= 1.0
        if selected.retry_budget_scope is RetryBudgetScope.GLOBAL:
            scoped_budget_available = global_available
        elif selected.retry_budget_scope is RetryBudgetScope.WORKSPACE_TOKEN_BUCKET:
            scoped_budget_available = workspace_available
        else:
            scoped_budget_available = global_available and workspace_available
        budget_available = strategy not in BUDGET_STRATEGIES or scoped_budget_available
        if state.attempts >= selected.max_attempts or not budget_available:
            state.status = "failed"
            state.terminal_at_seconds = failed_at
            state.retry_budget_exhausted = not budget_available
            return
        retry_count += 1
        if strategy in BUDGET_STRATEGIES and selected.retry_budget_scope is not RetryBudgetScope.GLOBAL:
            workspace_retry_tokens[state.task.workspace_id] -= 1.0
            if selected.retry_budget_scope is not RetryBudgetScope.WORKSPACE_TOKEN_BUCKET:
                global_retry_tokens -= 1.0
        state.retries += 1
        state.status = "waiting"
        state.ready_at_seconds = failed_at + _backoff_seconds(state, strategy, seed, selected)
        retry_release_times.append(state.ready_at_seconds)

    while any(state.status in {"waiting", "running"} for state in states):
        while capacity_index < len(ordered_capacity_events) and ordered_capacity_events[capacity_index].at_seconds <= current_time:
            current_worker_count = ordered_capacity_events[capacity_index].worker_count
            capacity_index += 1
        active_ending = [attempt for attempt in active if attempt.event_at_seconds <= current_time]
        for attempt in active_ending:
            active.remove(attempt)
            elapsed = attempt.event_at_seconds - attempt.started_at_seconds
            useful = attempt.target_progress_seconds - attempt.start_progress_seconds
            service_demand += elapsed
            provider_costed_service += elapsed * attempt.provider_cost_multiplier
            if attempt.secondary_provider:
                secondary_provider_service += elapsed
            checkpoint_overhead += max(0.0, elapsed - useful)
            if attempt.will_fail:
                durable = _durable_progress(attempt.target_progress_seconds, attempt.state.task.actual_runtime_seconds, selected, attempt.checkpoint_enabled)
                fail_attempt(attempt, attempt.target_progress_seconds, durable, current_time)
            else:
                attempt.state.status = "completed"
                attempt.state.completed_at_seconds = current_time
                attempt.state.terminal_at_seconds = current_time

        if not outage_processed and outage_start is not None and outage_start <= current_time:
            for attempt in tuple(active):
                elapsed = current_time - attempt.started_at_seconds
                progress, durable, overhead = _progress_after_wall(attempt.start_progress_seconds, elapsed, attempt.state.task.actual_runtime_seconds, selected, attempt.checkpoint_enabled)
                service_demand += elapsed
                provider_costed_service += elapsed * attempt.provider_cost_multiplier
                if attempt.secondary_provider:
                    secondary_provider_service += elapsed
                checkpoint_overhead += overhead
                fail_attempt(attempt, progress, durable, current_time)
                active.remove(attempt)
            outage_processed = True

        for state in states:
            if state.status == "waiting" and state.task.cache_hit and state.ready_at_seconds <= current_time:
                state.status = "completed"
                state.completed_at_seconds = state.ready_at_seconds + state.task.cache_lookup_seconds
                state.terminal_at_seconds = state.completed_at_seconds

        ready = [state for state in states if state.status == "waiting" and not state.task.cache_hit and state.ready_at_seconds <= current_time]
        peak_ready_queue = max(peak_ready_queue, len(ready))
        provider_available = outage_end is None or current_time >= outage_end or not outage_processed
        while ready and len(active) < current_worker_count and provider_available:
            priority_ready = any(state.task.priority >= 4 for state in ready)
            effective_reserved_workers = min(selected.high_priority_reserved_workers, current_worker_count - 1)
            low_priority_running = sum(attempt.state.task.priority < 4 for attempt in active)
            if not priority_ready and effective_reserved_workers > 0 and low_priority_running >= current_worker_count - effective_reserved_workers:
                break
            chosen = _ready_choice(ready, current_time, selected)
            ready.remove(chosen)
            active.append(_schedule_attempt(chosen, strategy, seed, current_time, selected))

        if not any(state.status in {"waiting", "running"} for state in states):
            break
        candidates = [state.ready_at_seconds for state in states if state.status == "waiting" and state.ready_at_seconds > current_time]
        candidates.extend(attempt.event_at_seconds for attempt in active if attempt.event_at_seconds > current_time)
        if not outage_processed and outage_start is not None and outage_start > current_time:
            candidates.append(outage_start)
        if outage_processed and outage_end is not None and outage_end > current_time:
            candidates.append(outage_end)
        if capacity_index < len(ordered_capacity_events) and ordered_capacity_events[capacity_index].at_seconds > current_time:
            candidates.append(ordered_capacity_events[capacity_index].at_seconds)
        if not candidates:
            raise RuntimeError("retry simulation cannot make progress")
        current_time = min(candidates)

    completed_states = [state for state in states if state.status == "completed"]
    completion_times = [float(state.completed_at_seconds) - state.task.queued_at_seconds for state in completed_states]
    completion_slo_count = sum(value <= selected.completion_slo_seconds for value in completion_times)
    original_service_demand = sum(task.actual_runtime_seconds for task in tasks if not task.cache_hit)
    last_arrival = max(task.queued_at_seconds for task in tasks)
    disturbance_end = max(last_arrival, outage_end or last_arrival)
    last_terminal = max(float(state.terminal_at_seconds) for state in states)
    makespan = last_terminal - first_arrival
    billed_worker_seconds = worker_capacity_between(first_arrival, last_terminal, selected.worker_count, ordered_capacity_events)
    metrics = RetryRunMetrics(completion_rate=len(completed_states) / len(states), completion_slo_rate=completion_slo_count / len(states), failed_rate=1 - len(completed_states) / len(states), p95_end_to_end_seconds=_percentile(completion_times, 95), recovery_after_disturbance_seconds=max(0.0, last_terminal - disturbance_end), service_demand_seconds=service_demand, demand_amplification=service_demand / original_service_demand, secondary_provider_service_share=0.0 if service_demand == 0 else secondary_provider_service / service_demand, provider_cost_index=provider_costed_service / original_service_demand, wasted_useful_seconds=wasted_useful, checkpoint_overhead_seconds=checkpoint_overhead, checkpoint_saved_work_seconds=checkpoint_saved_work, retry_count=retry_count, retry_budget_exhaustion_rate=sum(state.retry_budget_exhausted for state in states) / len(states), peak_ready_queue=peak_ready_queue, peak_retry_release_count=_peak_release_count(retry_release_times, selected.retry_burst_window_seconds), makespan_seconds=makespan, billed_worker_seconds=billed_worker_seconds, estimated_worker_cost=billed_worker_seconds * selected.worker_hour_cost / 3_600)
    task_results = tuple(RetryTaskResult(task_id=state.task.task_id, workspace_id=state.task.workspace_id, priority=state.task.priority, queued_at_seconds=state.task.queued_at_seconds, first_started_at_seconds=state.first_started_at_seconds, completed_at_seconds=state.completed_at_seconds, terminal_at_seconds=float(state.terminal_at_seconds), status=state.status, attempts=state.attempts, retries=state.retries, retry_budget_exhausted=state.retry_budget_exhausted) for state in states)
    return RetryRun(seed=seed, strategy=strategy, metrics=metrics, task_results=task_results, capacity_events=ordered_capacity_events)


def _summarize_retry(rows: Sequence[RetryRun], strategy: RetryStrategy) -> RetrySummary:
    selected = [row.metrics for row in rows if row.strategy is strategy]
    return RetrySummary(strategy=strategy, completion_rate=_estimate([metrics.completion_rate for metrics in selected]), completion_slo_rate=_estimate([metrics.completion_slo_rate for metrics in selected]), failed_rate=_estimate([metrics.failed_rate for metrics in selected]), p95_end_to_end_seconds=_estimate([metrics.p95_end_to_end_seconds for metrics in selected]), recovery_after_disturbance_seconds=_estimate([metrics.recovery_after_disturbance_seconds for metrics in selected]), service_demand_seconds=_estimate([metrics.service_demand_seconds for metrics in selected]), demand_amplification=_estimate([metrics.demand_amplification for metrics in selected]), secondary_provider_service_share=_estimate([metrics.secondary_provider_service_share for metrics in selected]), provider_cost_index=_estimate([metrics.provider_cost_index for metrics in selected]), wasted_useful_seconds=_estimate([metrics.wasted_useful_seconds for metrics in selected]), checkpoint_overhead_seconds=_estimate([metrics.checkpoint_overhead_seconds for metrics in selected]), checkpoint_saved_work_seconds=_estimate([metrics.checkpoint_saved_work_seconds for metrics in selected]), retry_count=_estimate([float(metrics.retry_count) for metrics in selected]), retry_budget_exhaustion_rate=_estimate([metrics.retry_budget_exhaustion_rate for metrics in selected]), peak_ready_queue=_estimate([float(metrics.peak_ready_queue) for metrics in selected]), peak_retry_release_count=_estimate([float(metrics.peak_retry_release_count) for metrics in selected]), makespan_seconds=_estimate([metrics.makespan_seconds for metrics in selected]), billed_worker_seconds=_estimate([metrics.billed_worker_seconds for metrics in selected]), estimated_worker_cost=_estimate([metrics.estimated_worker_cost for metrics in selected]))


def generate_retry_workloads(scheduler_config: SchedulerExperimentConfig, seeds: Sequence[int]) -> tuple[RetryWorkload, ...]:
    if not seeds:
        raise ValueError("seeds must not be empty")
    workloads: list[RetryWorkload] = []
    for seed in seeds:
        tasks, prediction_metrics = generate_scheduler_workload(scheduler_config, random_seed=seed)
        workloads.append(RetryWorkload(seed=seed, tasks=tuple(tasks), offered_load_ratio=prediction_metrics[3]))
    return tuple(workloads)


def run_retry_benchmark(scheduler_config: SchedulerExperimentConfig, *, retry_config: RetryExperimentConfig | None = None, strategies: Sequence[RetryStrategy] = tuple(RetryStrategy), seeds: Sequence[int] = (11, 23, 37, 42, 59), workloads: Sequence[RetryWorkload] | None = None) -> RetryBenchmark:
    if not strategies or not seeds:
        raise ValueError("strategies and seeds must not be empty")
    selected_retry = retry_config or RetryExperimentConfig(worker_count=scheduler_config.worker_count)
    selected_workloads = tuple(workloads) if workloads is not None else generate_retry_workloads(scheduler_config, seeds)
    if tuple(workload.seed for workload in selected_workloads) != tuple(seeds):
        raise ValueError("workload seeds must match requested seeds in order")
    rows: list[RetryRun] = []
    for workload in selected_workloads:
        for strategy in strategies:
            rows.append(simulate_retry_strategy(workload.tasks, strategy, seed=workload.seed, config=selected_retry))
    summaries = tuple(_summarize_retry(rows, strategy) for strategy in strategies)
    return RetryBenchmark(scheduler_config=scheduler_config, retry_config=selected_retry, rows=tuple(rows), summaries=summaries, offered_load_ratio=_estimate([workload.offered_load_ratio for workload in selected_workloads]))
