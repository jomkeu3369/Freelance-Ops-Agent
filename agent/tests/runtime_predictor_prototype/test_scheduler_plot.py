from __future__ import annotations

from pathlib import Path

from .plot_scheduler_evaluation import build_multidimensional_evaluation_plot
from .plot_scheduler_simulation import build_scheduler_simulation_plot
from .scheduler_simulation import SchedulerExperimentConfig, SchedulingPolicy


def test_scheduler_plot_is_created_with_all_policy_results() -> None:
    destination = Path(__file__).with_name("_scheduler_plot_test.png")
    config = SchedulerExperimentConfig(workspace_count=2, tasks_per_workspace=8, worker_count=2, training_samples=200)
    try:
        path, benchmark = build_scheduler_simulation_plot(destination, config=config, seeds=(7, 9))
        assert path == destination
        assert path.exists()
        assert path.stat().st_size > 10_000
        assert {summary.policy for summary in benchmark.summaries} == set(SchedulingPolicy)
    finally:
        destination.unlink(missing_ok=True)


def test_multidimensional_scheduler_plot_is_created() -> None:
    destination = Path(__file__).with_name("_scheduler_evaluation_plot_test.png")
    config = SchedulerExperimentConfig(workspace_count=2, tasks_per_workspace=8, worker_count=2, training_samples=200)
    try:
        path, evaluation = build_multidimensional_evaluation_plot(destination, config=config, seeds=(7, 9))
        assert path == destination
        assert path.exists()
        assert path.stat().st_size > 10_000
        assert len(evaluation.summaries) == len(SchedulingPolicy)
    finally:
        destination.unlink(missing_ok=True)
