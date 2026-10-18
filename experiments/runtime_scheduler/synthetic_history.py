from __future__ import annotations

import math
import random
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from .task_models import AgentTask, TaskExecutionLog


def split_history(history: Sequence[TaskExecutionLog], *, validation_fraction: float = 0.25, random_seed: int = 42) -> tuple[list[TaskExecutionLog], list[TaskExecutionLog]]:
    if len(history) < 4:
        raise ValueError("at least four records are required to split history")

    if not 0 < validation_fraction < 1:
        raise ValueError("validation_fraction must be between zero and one")

    shuffled = list(history)
    random.Random(random_seed).shuffle(shuffled)
    validation_size = max(1, round(len(shuffled) * validation_fraction))

    return shuffled[validation_size:], shuffled[:validation_size]


def chronological_split_history(history: Sequence[TaskExecutionLog], *, validation_fraction: float = 0.25) -> tuple[list[TaskExecutionLog], list[TaskExecutionLog]]:
    if len(history) < 4:
        raise ValueError("at least four records are required to split history")
    if not 0 < validation_fraction < 1:
        raise ValueError("validation_fraction must be between zero and one")
    ordered = sorted(history, key=lambda record: record.queued_at)
    validation_size = max(1, round(len(ordered) * validation_fraction))
    return ordered[:-validation_size], ordered[-validation_size:]


def generate_synthetic_history(sample_count: int = 5_000, *, random_seed: int = 42, latency_drift: float = 0.0) -> list[TaskExecutionLog]:
    if sample_count < 1:
        raise ValueError("sample_count must be positive")
    if latency_drift < 0:
        raise ValueError("latency_drift must be non-negative")

    rng = random.Random(random_seed)
    task_complexity = {
        "tool_call": 0.55,
        "documentation": 0.85,
        "code_review": 1.25,
        "data_analysis": 1.45,
        "research": 1.70,
    }
    model_latency = {
        "gpt-fast": 0.72,
        "gemini-fast": 0.80,
        "gpt-balanced": 1.00,
        "gpt-reasoning": 1.48,
    }

    task_types = tuple(task_complexity)
    models = tuple(model_latency)
    origin = datetime(2026, 1, 1, tzinfo=UTC)
    history: list[TaskExecutionLog] = []

    for index in range(sample_count):
        task_type = rng.choice(task_types)
        model = rng.choice(models)
        input_tokens = round(math.exp(rng.uniform(math.log(300), math.log(30_000))))
        context_tokens = round(math.exp(rng.uniform(math.log(100), math.log(80_000)))) - 100
        file_count = min(50, round(rng.expovariate(1 / 8)))
        subagent_depth = rng.choices((0, 1, 2), weights=(0.60, 0.32, 0.08), k=1)[0]

        task = AgentTask(
            task_type=task_type,
            model=model,
            input_tokens=input_tokens,
            context_tokens=context_tokens,
            file_count=file_count,
            subagent_depth=subagent_depth
        )

        token_cost = 0.0028 * input_tokens**0.88
        context_cost = 0.00017 * context_tokens
        large_context_overhead = 0.000000010 * max(context_tokens - 30_000, 0) ** 2
        file_overhead = 0.72 * file_count + 0.055 * max(file_count - 12, 0) ** 2
        hierarchy_overhead = 5.5 * subagent_depth + 0.00006 * context_tokens * subagent_depth
        interaction = 0.000015 * input_tokens * file_count
        expected = 1.8 + model_latency[model] * task_complexity[task_type] * (
            token_cost
            + context_cost
            + large_context_overhead
            + file_overhead
            + hierarchy_overhead
            + interaction
        )
        drift_multiplier = 1 + latency_drift * index / max(sample_count - 1, 1)
        expected *= drift_multiplier
        noise = rng.gauss(0.0, 1.6 + expected * 0.09)
        runtime_seconds = round(max(0.05, expected + noise), 6)

        queued_at = origin + timedelta(seconds=index * 17)
        queue_wait_seconds = round(rng.expovariate(1 / 12), 6)
        started_at = queued_at + timedelta(seconds=queue_wait_seconds)
        completed_at = started_at + timedelta(seconds=runtime_seconds)
        record = TaskExecutionLog(
            task_id=f"synthetic-{index:06d}",
            task=task,
            queued_at=queued_at,
            started_at=started_at,
            completed_at=completed_at,
            runtime_seconds=runtime_seconds,
            success=rng.random() >= 0.025,
            actual_tool_calls=max(0, round(file_count / 3 + rng.gauss(1.0, 1.5))),
            output_tokens=max(0, round(input_tokens * rng.uniform(0.05, 0.35))),
            retry_count=rng.choices((0, 1, 2), weights=(0.91, 0.08, 0.01), k=1)[0]
        )
        history.append(record)
    return history
