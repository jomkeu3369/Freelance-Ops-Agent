from __future__ import annotations

import json
from pathlib import Path

from routing_benchmark.collector_capacity import evaluate_collector_capacity, simulate_collector


def test_virtual_thread_concurrency_prevents_backlog_at_400_per_minute() -> None:
    sequential = simulate_collector(concurrency=1, latency_ms=500, arrivals_per_minute=400)
    parallel = simulate_collector(concurrency=20, latency_ms=500, arrivals_per_minute=400)

    assert sequential["backlog_after_hour"] > 10_000
    assert parallel["backlog_after_hour"] <= 20
    assert parallel["p95_collection_delay_seconds"] < 3


def test_capacity_report_always_includes_plot_table(tmp_path: Path) -> None:
    outputs = evaluate_collector_capacity(tmp_path)

    assert len(outputs) == 4
    assert all(path.exists() for path in outputs)
    report = json.loads(outputs[0].read_text(encoding="utf-8"))
    assert len(report["results"]) == 64
