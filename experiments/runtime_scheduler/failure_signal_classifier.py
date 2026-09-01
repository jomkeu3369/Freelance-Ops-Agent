from __future__ import annotations

import math
import random
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .scheduler_simulation import MetricEstimate, _estimate, _percentile


class IncidentKind(StrEnum):
    INDEPENDENT_WORKER = "independent_worker"
    INDEPENDENT_TOOL = "independent_tool"
    PROVIDER_OUTAGE = "provider_outage"
    PROVIDER_RATE_LIMIT = "provider_rate_limit"


class SignalClassifierKind(StrEnum):
    PROVIDER_ERROR_THRESHOLD = "provider_error_threshold"
    CROSS_WORKSPACE_BURST = "cross_workspace_burst"
    WEIGHTED_RULE = "weighted_rule"
    LOGISTIC_REGRESSION = "logistic_regression"


SIGNAL_CLASSIFIER_LABELS = {SignalClassifierKind.PROVIDER_ERROR_THRESHOLD: "Provider error threshold", SignalClassifierKind.CROSS_WORKSPACE_BURST: "Cross-workspace burst", SignalClassifierKind.WEIGHTED_RULE: "Weighted multi-signal rule", SignalClassifierKind.LOGISTIC_REGRESSION: "Temporal logistic baseline"}
CORRELATED_KINDS = frozenset((IncidentKind.PROVIDER_OUTAGE, IncidentKind.PROVIDER_RATE_LIMIT))
OBSERVATION_WINDOWS = (2.0, 5.0, 10.0, 20.0, 30.0)


@dataclass(frozen=True, slots=True)
class FailureSignalRecord:
    incident_id: str
    incident_index: int
    observed_at_seconds: float
    provider_5xx_rate: float
    provider_429_rate: float
    timeout_rate: float
    cross_workspace_failure_ratio: float
    affected_worker_ratio: float
    provider_status_degraded: bool
    local_worker_crash_rate: float
    tool_failure_concentration: float
    final_incident_kind: IncidentKind
    final_label_available_at_seconds: float

    @property
    def correlated(self) -> bool:
        return self.final_incident_kind in CORRELATED_KINDS


@dataclass(frozen=True, slots=True)
class FailureIncidentLabel:
    incident_id: str
    predicted_correlated: bool
    prediction_confidence: float
    predicted_at_seconds: float
    final_incident_kind: IncidentKind | None
    final_label_source: str | None
    finalized_at_seconds: float | None

    def __post_init__(self) -> None:
        if not 0 <= self.prediction_confidence <= 1 or self.predicted_at_seconds < 0:
            raise ValueError("prediction confidence and time are invalid")
        final_fields = (self.final_incident_kind, self.final_label_source, self.finalized_at_seconds)
        if any(value is None for value in final_fields) and any(value is not None for value in final_fields):
            raise ValueError("final label fields must be set atomically")
        if self.finalized_at_seconds is not None and self.finalized_at_seconds < self.predicted_at_seconds:
            raise ValueError("final label must not predate prediction")


@dataclass(frozen=True, slots=True)
class SignalClassifierConfig:
    weighted_rule_threshold: float = 4.0
    provider_error_threshold: float = 0.25
    cross_workspace_threshold: float = 0.20
    temporal_train_ratio: float = 0.70
    detection_slo_seconds: float = 10.0
    action_window_seconds: float = 20.0

    def __post_init__(self) -> None:
        if self.weighted_rule_threshold < 0 or self.provider_error_threshold < 0 or self.cross_workspace_threshold < 0:
            raise ValueError("classifier thresholds must be non-negative")
        if not 0 < self.temporal_train_ratio < 1 or self.detection_slo_seconds <= 0 or self.action_window_seconds < self.detection_slo_seconds:
            raise ValueError("temporal split and action windows are invalid")


@dataclass(frozen=True, slots=True)
class SignalClassifierMetrics:
    action_false_positive_rate: float
    detection_false_negative_rate: float
    final_false_positive_rate: float
    final_false_negative_rate: float
    detection_within_slo_rate: float
    p95_detection_seconds: float
    mean_detection_seconds: float
    low_confidence_rate: float
    correlated_precision: float


@dataclass(frozen=True, slots=True)
class SignalClassifierRun:
    classifier: SignalClassifierKind
    metrics: SignalClassifierMetrics
    recall_by_kind: tuple[tuple[IncidentKind, float], ...]


@dataclass(frozen=True, slots=True)
class SignalClassifierSummary:
    classifier: SignalClassifierKind
    action_false_positive_rate: MetricEstimate
    detection_false_negative_rate: MetricEstimate
    final_false_positive_rate: MetricEstimate
    final_false_negative_rate: MetricEstimate
    detection_within_slo_rate: MetricEstimate
    p95_detection_seconds: MetricEstimate
    mean_detection_seconds: MetricEstimate
    low_confidence_rate: MetricEstimate
    correlated_precision: MetricEstimate
    recall_by_kind: tuple[tuple[IncidentKind, MetricEstimate], ...]
    operational_gate_pass_rate: float


@dataclass(frozen=True, slots=True)
class SignalClassifierBenchmark:
    config: SignalClassifierConfig
    rows: tuple[SignalClassifierRun, ...]
    summaries: tuple[SignalClassifierSummary, ...]
    selected_classifier: SignalClassifierKind | None


def _clip(value: float) -> float:
    return min(1.0, max(0.0, value))


def _noise(rng: random.Random, scale: float = 0.04) -> float:
    return rng.gauss(0.0, scale)


def _signals(kind: IncidentKind, elapsed: float, severity: float, time_constant: float, drifted: bool, rng: random.Random) -> tuple[float, float, float, float, float, bool, float, float]:
    progress = 1 - math.exp(-elapsed / time_constant)
    drift_scale = 0.55 if drifted else 1.0
    if kind is IncidentKind.INDEPENDENT_WORKER:
        values = (0.03 + _noise(rng), 0.02 + _noise(rng), 0.06 + _noise(rng), 0.08 + 0.22 * severity * progress + _noise(rng), 0.10 + 0.28 * severity * progress + _noise(rng), False, 0.25 + 0.55 * severity * progress + _noise(rng), 0.20 + _noise(rng))
    elif kind is IncidentKind.INDEPENDENT_TOOL:
        values = (0.05 + 0.18 * severity * progress + _noise(rng), 0.02 + _noise(rng), 0.06 + 0.15 * severity * progress + _noise(rng), 0.08 + 0.20 * severity * progress + _noise(rng), 0.10 + 0.22 * severity * progress + _noise(rng), False, 0.04 + _noise(rng), 0.50 + 0.40 * severity * progress + _noise(rng))
    elif kind is IncidentKind.PROVIDER_OUTAGE:
        status_probability = 0.25 if drifted else 0.65
        local_crash = (0.24 + 0.35 * severity * progress if drifted else 0.06 + 0.12 * severity * progress) + _noise(rng)
        values = (0.03 + 0.45 * severity * progress * drift_scale + _noise(rng), 0.02 + _noise(rng), 0.06 + 0.32 * severity * progress * drift_scale + _noise(rng), 0.10 + 0.55 * severity * progress + _noise(rng), 0.10 + 0.50 * severity * progress + _noise(rng), rng.random() < status_probability * progress, local_crash, 0.22 + 0.12 * severity * progress + _noise(rng))
    else:
        status_probability = 0.08 if drifted else 0.22
        tool_concentration = (0.42 + 0.35 * severity * progress if drifted else 0.20 + 0.10 * severity * progress) + _noise(rng)
        values = (0.03 + _noise(rng), 0.05 + 0.52 * severity * progress * drift_scale + _noise(rng), 0.05 + 0.16 * severity * progress * drift_scale + _noise(rng), 0.10 + 0.50 * severity * progress + _noise(rng), 0.10 + 0.45 * severity * progress + _noise(rng), rng.random() < status_probability * progress, 0.05 + 0.08 * severity * progress + _noise(rng), tool_concentration)
    return _clip(values[0]), _clip(values[1]), _clip(values[2]), _clip(values[3]), _clip(values[4]), bool(values[5]), _clip(values[6]), _clip(values[7])


def generate_failure_signal_history(incident_count: int = 2_000, *, random_seed: int = 42, observation_windows: Sequence[float] = OBSERVATION_WINDOWS, drift_start_ratio: float = 0.70) -> tuple[FailureSignalRecord, ...]:
    if incident_count < 100 or not observation_windows or any(value <= 0 for value in observation_windows) or not 0 < drift_start_ratio < 1:
        raise ValueError("incident generator values are invalid")
    rng = random.Random(random_seed)
    records: list[FailureSignalRecord] = []
    for incident_index in range(incident_count):
        kind = rng.choices(tuple(IncidentKind), weights=(0.35, 0.20, 0.30, 0.15), k=1)[0]
        severity = rng.uniform(0.40, 1.0)
        time_constant = rng.uniform(3.0, 10.0)
        drifted = incident_index >= incident_count * drift_start_ratio
        final_label_at = max(observation_windows) + rng.uniform(30.0, 180.0)
        for elapsed in observation_windows:
            signals = _signals(kind, elapsed, severity, time_constant, drifted, rng)
            records.append(FailureSignalRecord(incident_id=f"incident-{incident_index:06d}", incident_index=incident_index, observed_at_seconds=float(elapsed), provider_5xx_rate=signals[0], provider_429_rate=signals[1], timeout_rate=signals[2], cross_workspace_failure_ratio=signals[3], affected_worker_ratio=signals[4], provider_status_degraded=signals[5], local_worker_crash_rate=signals[6], tool_failure_concentration=signals[7], final_incident_kind=kind, final_label_available_at_seconds=final_label_at))
    return tuple(records)


def feature_vector(record: FailureSignalRecord) -> tuple[float, ...]:
    return (record.provider_5xx_rate, record.provider_429_rate, record.timeout_rate, record.cross_workspace_failure_ratio, record.affected_worker_ratio, float(record.provider_status_degraded), record.local_worker_crash_rate, record.tool_failure_concentration)


def weighted_rule_score(record: FailureSignalRecord) -> float:
    provider_error_rate = record.provider_5xx_rate + record.provider_429_rate + record.timeout_rate
    score = 2.0 * float(provider_error_rate >= 0.22) + float(provider_error_rate >= 0.40) + 2.0 * float(record.cross_workspace_failure_ratio >= 0.22) + float(record.affected_worker_ratio >= 0.28) + 2.0 * float(record.provider_status_degraded) - 2.0 * float(record.local_worker_crash_rate >= 0.45) - 2.0 * float(record.tool_failure_concentration >= 0.65)
    return score


def _rule_prediction(record: FailureSignalRecord, classifier: SignalClassifierKind, config: SignalClassifierConfig) -> tuple[bool, float]:
    if classifier is SignalClassifierKind.PROVIDER_ERROR_THRESHOLD:
        margin = record.provider_5xx_rate + record.provider_429_rate + record.timeout_rate - config.provider_error_threshold
    elif classifier is SignalClassifierKind.CROSS_WORKSPACE_BURST:
        margin = record.cross_workspace_failure_ratio - config.cross_workspace_threshold
    else:
        margin = (weighted_rule_score(record) - config.weighted_rule_threshold) / 4
    probability = 1 / (1 + math.exp(-6 * margin))
    return probability >= 0.5, probability


def _temporal_split(records: Sequence[FailureSignalRecord], ratio: float) -> tuple[list[FailureSignalRecord], list[FailureSignalRecord]]:
    maximum_index = max(record.incident_index for record in records)
    split_index = math.floor((maximum_index + 1) * ratio)
    return [record for record in records if record.incident_index < split_index], [record for record in records if record.incident_index >= split_index]


def _logistic_model(train_records: Sequence[FailureSignalRecord]) -> Pipeline:
    inputs = np.array([feature_vector(record) for record in train_records])
    targets = np.array([record.correlated for record in train_records], dtype=int)
    return Pipeline([("scale", StandardScaler()), ("model", LogisticRegression(max_iter=500, class_weight="balanced", random_state=42))]).fit(inputs, targets)


def _predictions(records: Sequence[FailureSignalRecord], classifier: SignalClassifierKind, config: SignalClassifierConfig, model: Pipeline | None) -> dict[str, list[tuple[FailureSignalRecord, bool, float]]]:
    grouped: dict[str, list[tuple[FailureSignalRecord, bool, float]]] = defaultdict(list)
    for record in records:
        if classifier is SignalClassifierKind.LOGISTIC_REGRESSION:
            if model is None:
                raise ValueError("logistic classifier requires a fitted model")
            probability = float(model.predict_proba(np.array([feature_vector(record)]))[0, 1])
            prediction = probability >= 0.5
        else:
            prediction, probability = _rule_prediction(record, classifier, config)
        grouped[record.incident_id].append((record, prediction, probability))
    for values in grouped.values():
        values.sort(key=lambda item: item[0].observed_at_seconds)
    return grouped


def _evaluate_classifier(records: Sequence[FailureSignalRecord], classifier: SignalClassifierKind, config: SignalClassifierConfig, model: Pipeline | None) -> SignalClassifierRun:
    grouped = _predictions(records, classifier, config, model)
    independent = [values for values in grouped.values() if not values[0][0].correlated]
    correlated = [values for values in grouped.values() if values[0][0].correlated]
    action_false_positives = sum(any(prediction and record.observed_at_seconds <= config.action_window_seconds for record, prediction, _ in values) for values in independent)
    detections = [next((record.observed_at_seconds for record, prediction, _ in values if prediction), config.action_window_seconds * 2) for values in correlated]
    detection_false_negatives = sum(value > config.detection_slo_seconds for value in detections)
    final_false_positives = sum(values[-1][1] for values in independent)
    final_false_negatives = sum(not values[-1][1] for values in correlated)
    true_positive_actions = sum(value <= config.action_window_seconds for value in detections)
    predicted_positive_actions = true_positive_actions + action_false_positives
    confidence_values = [max(probability, 1 - probability) for values in grouped.values() for _, _, probability in values]
    recall_by_kind: list[tuple[IncidentKind, float]] = []
    for kind in IncidentKind:
        selected = [values for values in grouped.values() if values[0][0].final_incident_kind is kind]
        if kind in CORRELATED_KINDS:
            recall = sum(any(prediction and record.observed_at_seconds <= config.detection_slo_seconds for record, prediction, _ in values) for values in selected) / len(selected)
        else:
            recall = sum(not any(prediction and record.observed_at_seconds <= config.action_window_seconds for record, prediction, _ in values) for values in selected) / len(selected)
        recall_by_kind.append((kind, recall))
    metrics = SignalClassifierMetrics(action_false_positive_rate=action_false_positives / len(independent), detection_false_negative_rate=detection_false_negatives / len(correlated), final_false_positive_rate=final_false_positives / len(independent), final_false_negative_rate=final_false_negatives / len(correlated), detection_within_slo_rate=1 - detection_false_negatives / len(correlated), p95_detection_seconds=_percentile(detections, 95), mean_detection_seconds=sum(detections) / len(detections), low_confidence_rate=sum(value < 0.70 for value in confidence_values) / len(confidence_values), correlated_precision=0.0 if predicted_positive_actions == 0 else true_positive_actions / predicted_positive_actions)
    return SignalClassifierRun(classifier=classifier, metrics=metrics, recall_by_kind=tuple(recall_by_kind))


def _summarize_runs(rows: Sequence[SignalClassifierRun], classifier: SignalClassifierKind) -> SignalClassifierSummary:
    selected = [row for row in rows if row.classifier is classifier]

    def estimate(name: str) -> MetricEstimate:
        return _estimate([float(getattr(row.metrics, name)) for row in selected])

    recall_by_kind = tuple((kind, _estimate([dict(row.recall_by_kind)[kind] for row in selected])) for kind in IncidentKind)
    passed = [row.metrics.action_false_positive_rate <= 0.10 and row.metrics.detection_false_negative_rate <= 0.15 and row.metrics.p95_detection_seconds <= 20.0 and row.metrics.correlated_precision >= 0.90 for row in selected]
    return SignalClassifierSummary(classifier=classifier, action_false_positive_rate=estimate("action_false_positive_rate"), detection_false_negative_rate=estimate("detection_false_negative_rate"), final_false_positive_rate=estimate("final_false_positive_rate"), final_false_negative_rate=estimate("final_false_negative_rate"), detection_within_slo_rate=estimate("detection_within_slo_rate"), p95_detection_seconds=estimate("p95_detection_seconds"), mean_detection_seconds=estimate("mean_detection_seconds"), low_confidence_rate=estimate("low_confidence_rate"), correlated_precision=estimate("correlated_precision"), recall_by_kind=recall_by_kind, operational_gate_pass_rate=sum(passed) / len(passed))


def run_signal_classifier_benchmark(*, config: SignalClassifierConfig | None = None, seeds: Sequence[int] = (11, 23, 37, 42, 59), incident_count: int = 2_000, classifiers: Sequence[SignalClassifierKind] = tuple(SignalClassifierKind)) -> SignalClassifierBenchmark:
    if not seeds or not classifiers:
        raise ValueError("seeds and classifiers must not be empty")
    selected_config = config or SignalClassifierConfig()
    rows: list[SignalClassifierRun] = []
    for seed in seeds:
        history = generate_failure_signal_history(incident_count, random_seed=seed, drift_start_ratio=selected_config.temporal_train_ratio)
        train, test = _temporal_split(history, selected_config.temporal_train_ratio)
        logistic = _logistic_model(train) if SignalClassifierKind.LOGISTIC_REGRESSION in classifiers else None
        rows.extend(_evaluate_classifier(test, classifier, selected_config, logistic) for classifier in classifiers)
    summaries = tuple(_summarize_runs(rows, classifier) for classifier in classifiers)
    eligible = [summary for summary in summaries if summary.operational_gate_pass_rate == 1.0]
    selected_classifier = min(eligible, key=lambda summary: (2 * summary.detection_false_negative_rate.mean + summary.action_false_positive_rate.mean, summary.mean_detection_seconds.mean, summary.low_confidence_rate.mean)).classifier if eligible else None
    return SignalClassifierBenchmark(config=selected_config, rows=tuple(rows), summaries=summaries, selected_classifier=selected_classifier)


def build_incident_label(record: FailureSignalRecord, *, predicted_correlated: bool, confidence: float, predicted_at_seconds: float, finalize: bool) -> FailureIncidentLabel:
    if predicted_at_seconds >= record.final_label_available_at_seconds:
        raise ValueError("prediction must be made before final incident label is available")
    return FailureIncidentLabel(incident_id=record.incident_id, predicted_correlated=predicted_correlated, prediction_confidence=confidence, predicted_at_seconds=predicted_at_seconds, final_incident_kind=record.final_incident_kind if finalize else None, final_label_source="incident_correlation" if finalize else None, finalized_at_seconds=record.final_label_available_at_seconds if finalize else None)
