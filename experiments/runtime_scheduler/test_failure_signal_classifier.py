from __future__ import annotations

import pytest

from .failure_signal_classifier import FailureIncidentLabel, IncidentKind, SignalClassifierConfig, SignalClassifierKind, build_incident_label, generate_failure_signal_history, run_signal_classifier_benchmark


def test_failure_signal_history_is_temporal_and_reproducible() -> None:
    first = generate_failure_signal_history(100, random_seed=7)
    second = generate_failure_signal_history(100, random_seed=7)
    assert first == second
    assert len(first) == 500
    assert all(record.observed_at_seconds < record.final_label_available_at_seconds for record in first)


def test_incident_label_requires_atomic_final_fields() -> None:
    with pytest.raises(ValueError, match="atomically"):
        FailureIncidentLabel(incident_id="incident", predicted_correlated=True, prediction_confidence=0.9, predicted_at_seconds=5.0, final_incident_kind=IncidentKind.PROVIDER_OUTAGE, final_label_source=None, finalized_at_seconds=30.0)


def test_final_label_cannot_leak_into_prediction_time() -> None:
    record = generate_failure_signal_history(100, random_seed=3)[0]
    pending = build_incident_label(record, predicted_correlated=False, confidence=0.8, predicted_at_seconds=record.observed_at_seconds, finalize=False)
    finalized = build_incident_label(record, predicted_correlated=False, confidence=0.8, predicted_at_seconds=record.observed_at_seconds, finalize=True)
    assert pending.final_incident_kind is None
    assert finalized.finalized_at_seconds == record.final_label_available_at_seconds
    with pytest.raises(ValueError, match="before final"):
        build_incident_label(record, predicted_correlated=False, confidence=0.8, predicted_at_seconds=record.final_label_available_at_seconds, finalize=False)


def test_signal_classifier_benchmark_evaluates_temporal_holdout() -> None:
    benchmark = run_signal_classifier_benchmark(seeds=[3, 5], incident_count=300)
    assert len(benchmark.summaries) == len(SignalClassifierKind)
    assert all(0 <= summary.action_false_positive_rate.mean <= 1 for summary in benchmark.summaries)
    assert all(len(summary.recall_by_kind) == len(IncidentKind) for summary in benchmark.summaries)
    assert benchmark.selected_classifier is SignalClassifierKind.WEIGHTED_RULE


def test_weighted_rule_threshold_changes_false_positive_tradeoff() -> None:
    permissive = run_signal_classifier_benchmark(config=SignalClassifierConfig(weighted_rule_threshold=2.0), seeds=[3], incident_count=300, classifiers=[SignalClassifierKind.WEIGHTED_RULE]).summaries[0]
    strict = run_signal_classifier_benchmark(config=SignalClassifierConfig(weighted_rule_threshold=6.0), seeds=[3], incident_count=300, classifiers=[SignalClassifierKind.WEIGHTED_RULE]).summaries[0]
    assert permissive.action_false_positive_rate.mean >= strict.action_false_positive_rate.mean
