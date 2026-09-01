from __future__ import annotations

from .task_attempt_telemetry_experiment import EXPECTED_VALID_FAULTS, TelemetryFault, inject_telemetry_fault, run_telemetry_delay_benchmark, run_telemetry_integrity_benchmark
from .task_attempt_telemetry import assemble_task_attempt_telemetry, generate_task_attempt_telemetry, validate_task_attempt_telemetry


def test_every_fault_has_expected_validator_behavior() -> None:
    benchmark = run_telemetry_integrity_benchmark(seeds=(3, 5), task_count=30)
    assert benchmark.contract_gate_passed
    assert all(summary.correct_behavior_rate == 1.0 for summary in benchmark.summaries)
    assert {summary.fault for summary in benchmark.summaries if summary.observed_valid_rate == 1.0} == EXPECTED_VALID_FAULTS


def test_receive_reordering_preserves_exact_reconstruction() -> None:
    events, expected = generate_task_attempt_telemetry(20, retry_rate=0.30, random_seed=7)
    reordered = inject_telemetry_fault(events, TelemetryFault.RECEIVE_REORDERING)
    dataset = assemble_task_attempt_telemetry(reordered)
    assert dataset.attempts == expected


def test_injected_defects_are_rejected_individually() -> None:
    events, _ = generate_task_attempt_telemetry(20, retry_rate=0.50, random_seed=11)
    defects = [fault for fault in TelemetryFault if fault not in EXPECTED_VALID_FAULTS]
    for fault in defects:
        report = validate_task_attempt_telemetry(inject_telemetry_fault(events, fault))
        assert not report.is_valid, fault


def test_delay_benchmark_marks_warning_and_replay_cutoff() -> None:
    summaries = run_telemetry_delay_benchmark(delays=(30.0, 60.0, 300.0, 301.0), seeds=(3, 5), task_count=10)
    by_delay = {summary.delay_seconds: summary for summary in summaries}
    assert by_delay[30.0].valid_rate == 1.0
    assert by_delay[30.0].warning_event_rate == 0.0
    assert by_delay[60.0].valid_rate == 1.0
    assert by_delay[60.0].warning_event_rate == 1.0
    assert by_delay[300.0].valid_rate == 1.0
    assert by_delay[301.0].valid_rate == 0.0
