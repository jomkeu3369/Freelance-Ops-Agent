from __future__ import annotations

from pathlib import Path

from .hierarchical_scheduler_simulation import HierarchicalStrategy
from .plot_autoscaling_reliability import build_scaling_cost_sensitivity_plot, build_scaling_reliability_comparison_plot
from .plot_autoscaling_simulation import build_autoscaling_comparison_plot
from .plot_hierarchical_scheduler_simulation import build_hierarchical_comparison_plot, build_hierarchical_scenario_table_plot, build_hierarchical_sensitivity_plot
from .plot_hierarchical_reliability import build_hierarchical_prediction_drift_plot, build_hierarchical_reliability_comparison_plot, build_hierarchical_scale_success_sensitivity_plot
from .plot_hierarchical_retry_simulation import build_hierarchical_retry_comparison_plot, build_hierarchical_retry_mode_table_plot, build_hierarchical_retry_sensitivity_plot
from .plot_failure_classifier_simulation import build_failure_classifier_error_plot, build_secondary_provider_tradeoff_plot
from .plot_failure_signal_classifier import build_failure_signal_classifier_comparison_plot, build_failure_signal_classifier_table_plot, build_failure_signal_threshold_plot
from .plot_overload_simulation import build_overload_admission_plot
from .plot_retry_checkpoint_simulation import build_checkpoint_interval_sensitivity_plot, build_retry_failure_sensitivity_plot, build_retry_outage_comparison_plot, build_retry_strategy_comparison_plot
from .plot_scheduler_evaluation import build_multidimensional_evaluation_plot
from .plot_scheduler_simulation import build_scheduler_simulation_plot
from .plot_shadow_replay import build_shadow_replay_validation_plot
from .plot_tenant_fairness_simulation import build_tenant_fairness_comparison_plot, build_tenant_fairness_scenario_table_plot
from .plot_task_attempt_telemetry import build_task_attempt_telemetry_delay_plot, build_task_attempt_telemetry_integrity_table_plot
from .plot_workspace_retry_budget import build_workspace_retry_budget_comparison_plot, build_workspace_retry_budget_sensitivity_plot, build_workspace_retry_budget_table_plot
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


def test_overload_admission_plot_is_created() -> None:
    destination = Path(__file__).with_name("_overload_admission_plot_test.png")
    config = SchedulerExperimentConfig(workspace_count=2, tasks_per_workspace=8, worker_count=2, mean_interarrival_seconds=2.0, training_samples=200)
    try:
        path, benchmark = build_overload_admission_plot(destination, config=config, seeds=(7, 9))
        assert path == destination
        assert path.exists()
        assert path.stat().st_size > 10_000
        assert len(benchmark.summaries) == 4
    finally:
        destination.unlink(missing_ok=True)


def test_autoscaling_comparison_plot_is_created() -> None:
    destination = Path(__file__).with_name("_autoscaling_plot_test.png")
    config = SchedulerExperimentConfig(workspace_count=2, tasks_per_workspace=8, worker_count=2, mean_interarrival_seconds=2.0, training_samples=200)
    try:
        path, benchmark = build_autoscaling_comparison_plot(destination, config=config, seeds=(7, 9))
        assert path == destination
        assert path.exists()
        assert path.stat().st_size > 10_000
        assert len(benchmark.summaries) == 5
    finally:
        destination.unlink(missing_ok=True)


def test_scaling_reliability_comparison_plot_is_created() -> None:
    destination = Path(__file__).with_name("_scaling_reliability_plot_test.png")
    config = SchedulerExperimentConfig(workspace_count=2, tasks_per_workspace=8, worker_count=2, mean_interarrival_seconds=2.0, training_samples=200)
    try:
        path, benchmark, workloads = build_scaling_reliability_comparison_plot(destination, config=config, seeds=(7, 9))
        assert path == destination
        assert path.exists()
        assert path.stat().st_size > 10_000
        assert len(benchmark.summaries) == 5
        assert len(workloads) == 2
    finally:
        destination.unlink(missing_ok=True)


def test_scaling_cost_sensitivity_plot_is_created() -> None:
    destination = Path(__file__).with_name("_scaling_cost_plot_test.png")
    config = SchedulerExperimentConfig(workspace_count=2, tasks_per_workspace=8, worker_count=2, mean_interarrival_seconds=2.0, training_samples=200)
    try:
        path, benchmarks = build_scaling_cost_sensitivity_plot(destination, config=config, cooldowns=(0.0, 60.0), minimum_billings=(60.0, 120.0), seeds=(7, 9))
        assert path == destination
        assert path.exists()
        assert path.stat().st_size > 10_000
        assert len(benchmarks) == 4
    finally:
        destination.unlink(missing_ok=True)


def test_retry_checkpoint_plots_are_created() -> None:
    destinations = tuple(Path(__file__).with_name(name) for name in ("_retry_comparison_test.png", "_retry_failure_test.png", "_checkpoint_interval_test.png", "_retry_outage_test.png"))
    config = SchedulerExperimentConfig(workspace_count=2, tasks_per_workspace=8, worker_count=2, mean_interarrival_seconds=3.0, training_samples=200)
    try:
        comparison_path, benchmark, workloads = build_retry_strategy_comparison_plot(destinations[0], scheduler_config=config, seeds=(7, 9))
        failure_path, failure_benchmarks = build_retry_failure_sensitivity_plot(destinations[1], scheduler_config=config, probabilities=(0.0, 0.2), seeds=(7, 9), workloads=workloads)
        interval_path, interval_benchmarks = build_checkpoint_interval_sensitivity_plot(destinations[2], scheduler_config=config, intervals=(10.0, 30.0), seeds=(7, 9), workloads=workloads)
        outage_path, outage_benchmark = build_retry_outage_comparison_plot(destinations[3], scheduler_config=config, seeds=(7, 9), workloads=workloads)
        assert (comparison_path, failure_path, interval_path, outage_path) == destinations
        assert all(path.exists() and path.stat().st_size > 10_000 for path in destinations)
        assert len(benchmark.summaries) == 6
        assert len(failure_benchmarks) == 2
        assert len(interval_benchmarks) == 2
        assert len(outage_benchmark.summaries) == 6
    finally:
        for destination in destinations:
            destination.unlink(missing_ok=True)


def test_shadow_replay_validation_plot_is_created() -> None:
    destination = Path(__file__).with_name("_shadow_replay_plot_test.png")
    config = SchedulerExperimentConfig(workspace_count=2, tasks_per_workspace=8, worker_count=2, mean_interarrival_seconds=3.0, training_samples=200)
    try:
        path, benchmark = build_shadow_replay_validation_plot(destination, config=config, seeds=(7, 9))
        assert path == destination
        assert path.exists()
        assert path.stat().st_size > 10_000
        assert len(benchmark.summaries) == 5
        assert benchmark.maximum_fifo_replay_delta == 0.0
    finally:
        destination.unlink(missing_ok=True)


def test_tenant_fairness_plots_are_created() -> None:
    destinations = tuple(Path(__file__).with_name(name) for name in ("_tenant_fairness_test.png", "_tenant_scenarios_test.png"))
    try:
        comparison_path, benchmark = build_tenant_fairness_comparison_plot(destinations[0], seeds=(3, 5))
        scenario_path, scenario_benchmark = build_tenant_fairness_scenario_table_plot(destinations[1], benchmark=benchmark, seeds=(3, 5))
        assert (comparison_path, scenario_path) == destinations
        assert all(path.exists() and path.stat().st_size > 10_000 for path in destinations)
        assert scenario_benchmark is benchmark
        assert len(benchmark.summaries) == 5
    finally:
        for destination in destinations:
            destination.unlink(missing_ok=True)


def test_hierarchical_scheduler_plots_are_created() -> None:
    destinations = tuple(Path(__file__).with_name(name) for name in ("_hierarchical_comparison_test.png", "_hierarchical_scenario_test.png", "_hierarchical_sensitivity_test.png"))
    try:
        comparison_path, benchmark = build_hierarchical_comparison_plot(destinations[0], seeds=(3, 5))
        scenario_path, scenario_benchmark = build_hierarchical_scenario_table_plot(destinations[1], benchmark=benchmark, seeds=(3, 5))
        sensitivity_path, sensitivity = build_hierarchical_sensitivity_plot(destinations[2], seeds=(3, 5), delays=(0.0, 30.0), factors=(1.5, 2.0), quota_bursts=(120.0, 240.0))
        assert (comparison_path, scenario_path, sensitivity_path) == destinations
        assert all(path.exists() and path.stat().st_size > 10_000 for path in destinations)
        assert scenario_benchmark is benchmark
        assert len(benchmark.summaries) == len(HierarchicalStrategy)
        assert all(len(sensitivity[name]) == 2 for name in ("delay", "factor", "quota"))
    finally:
        for destination in destinations:
            destination.unlink(missing_ok=True)


def test_hierarchical_reliability_plots_are_created() -> None:
    destinations = tuple(Path(__file__).with_name(name) for name in ("_hierarchical_reliability_test.png", "_hierarchical_success_boundary_test.png", "_hierarchical_prediction_drift_test.png"))
    try:
        comparison_path, benchmark = build_hierarchical_reliability_comparison_plot(destinations[0], seeds=(3, 5))
        success_path, success_summaries = build_hierarchical_scale_success_sensitivity_plot(destinations[1], seeds=(3, 5), probabilities=(0.0, 0.7, 1.0))
        drift_path, drift_summaries = build_hierarchical_prediction_drift_plot(destinations[2], seeds=(3, 5), multipliers=(0.8, 1.0))
        assert (comparison_path, success_path, drift_path) == destinations
        assert all(path.exists() and path.stat().st_size > 10_000 for path in destinations)
        assert len(benchmark.summaries) == 5
        assert all(len(values) == 3 for values in success_summaries.values())
        assert len(drift_summaries) == 2
    finally:
        for destination in destinations:
            destination.unlink(missing_ok=True)


def test_hierarchical_retry_plots_are_created() -> None:
    destinations = tuple(Path(__file__).with_name(name) for name in ("_hierarchical_retry_test.png", "_hierarchical_retry_table_test.png", "_hierarchical_retry_sensitivity_test.png"))
    try:
        comparison_path, benchmark = build_hierarchical_retry_comparison_plot(destinations[0], seeds=(3, 5))
        table_path, table_benchmark = build_hierarchical_retry_mode_table_plot(destinations[1], benchmark=benchmark, seeds=(3, 5))
        sensitivity_path, sensitivity = build_hierarchical_retry_sensitivity_plot(destinations[2], seeds=(3, 5), failover_delays=(10.0, 20.0), failure_probabilities=(0.1, 0.2), retry_budgets=(0.1, 0.2))
        assert (comparison_path, table_path, sensitivity_path) == destinations
        assert all(path.exists() and path.stat().st_size > 10_000 for path in destinations)
        assert table_benchmark is benchmark
        assert len(benchmark.summaries) == 5
        assert all(len(values) == 2 for values in sensitivity.values())
    finally:
        for destination in destinations:
            destination.unlink(missing_ok=True)


def test_failure_classifier_and_provider_plots_are_created() -> None:
    destinations = tuple(Path(__file__).with_name(name) for name in ("_failure_classifier_test.png", "_secondary_provider_test.png"))
    try:
        classifier_path, classifier = build_failure_classifier_error_plot(destinations[0], seeds=(3, 5), false_negative_rates=(0.0, 0.1), false_positive_rates=(0.0, 0.1))
        provider_path, provider = build_secondary_provider_tradeoff_plot(destinations[1], seeds=(3, 5), latency_multipliers=(1.0, 1.15), quality_failure_rates=(0.0, 0.05), cost_multipliers=(1.0, 1.25))
        assert (classifier_path, provider_path) == destinations
        assert all(path.exists() and path.stat().st_size > 10_000 for path in destinations)
        assert classifier["grid"].shape == (2, 2)
        assert all(len(values) == 2 for values in provider.values())
    finally:
        for destination in destinations:
            destination.unlink(missing_ok=True)


def test_failure_signal_classifier_plots_are_created() -> None:
    destinations = tuple(Path(__file__).with_name(name) for name in ("_failure_signal_comparison_test.png", "_failure_signal_table_test.png", "_failure_signal_threshold_test.png"))
    try:
        comparison_path, benchmark = build_failure_signal_classifier_comparison_plot(destinations[0], seeds=(3, 5), incident_count=300)
        table_path, table_benchmark = build_failure_signal_classifier_table_plot(destinations[1], benchmark=benchmark, seeds=(3, 5), incident_count=300)
        threshold_path, summaries = build_failure_signal_threshold_plot(destinations[2], seeds=(3, 5), incident_count=300, thresholds=(3.0, 4.0))
        assert (comparison_path, table_path, threshold_path) == destinations
        assert all(path.exists() and path.stat().st_size > 10_000 for path in destinations)
        assert table_benchmark is benchmark
        assert len(summaries) == 2
    finally:
        for destination in destinations:
            destination.unlink(missing_ok=True)


def test_workspace_retry_budget_plots_are_created() -> None:
    destinations = tuple(Path(__file__).with_name(name) for name in ("_workspace_retry_comparison_test.png", "_workspace_retry_table_test.png", "_workspace_retry_sensitivity_test.png"))
    try:
        comparison_path, benchmark = build_workspace_retry_budget_comparison_plot(destinations[0], seeds=(3, 5))
        table_path, table_benchmark = build_workspace_retry_budget_table_plot(destinations[1], benchmark=benchmark, seeds=(3, 5))
        sensitivity_path, sensitivity = build_workspace_retry_budget_sensitivity_plot(destinations[2], seeds=(3,), capacities=(8.0, 12.0), refill_rates=(0.05, 0.10), distributed_failure_rates=(0.05, 0.20))
        assert (comparison_path, table_path, sensitivity_path) == destinations
        assert all(path.exists() and path.stat().st_size > 10_000 for path in destinations)
        assert table_benchmark is benchmark
        assert len(benchmark.summaries) == 4
        assert all(len(values) == 2 for values in sensitivity.values())
    finally:
        for destination in destinations:
            destination.unlink(missing_ok=True)


def test_task_attempt_telemetry_plots_are_created() -> None:
    destinations = tuple(Path(__file__).with_name(name) for name in ("_task_attempt_integrity_test.png", "_task_attempt_delay_test.png"))
    try:
        table_path, benchmark = build_task_attempt_telemetry_integrity_table_plot(destinations[0], seeds=(3, 5), task_count=20)
        delay_path, delays = build_task_attempt_telemetry_delay_plot(destinations[1], delays=(30.0, 60.0, 300.0, 301.0), seeds=(3, 5), task_count=10)
        assert (table_path, delay_path) == destinations
        assert all(path.exists() and path.stat().st_size > 10_000 for path in destinations)
        assert benchmark.contract_gate_passed
        assert len(delays) == 4
    finally:
        for destination in destinations:
            destination.unlink(missing_ok=True)
