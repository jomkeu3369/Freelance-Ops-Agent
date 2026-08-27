from __future__ import annotations

import hashlib
import hmac
from datetime import datetime
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from .shadow_evaluation import CorrectionSource, Route, ShadowTrace


class RouteObservationData(BaseModel):
    """Exact allowlist persisted by Spring's route observation projection."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    route: Route
    decision_source: str = Field(validation_alias=AliasChoices("decisionSource", "decision_source"))
    reason_codes: list[str] = Field(default_factory=list, validation_alias=AliasChoices("reasonCodes", "reason_codes"))
    evaluator_provider: str | None = Field(default=None, validation_alias=AliasChoices("evaluatorProvider", "evaluator_provider"))
    evaluator_model: str | None = Field(default=None, validation_alias=AliasChoices("evaluatorModel", "evaluator_model"))
    evaluator_suggested_route: Route | None = Field(default=None, validation_alias=AliasChoices("evaluatorSuggestedRoute", "evaluator_suggested_route"))
    failure_code: str | None = Field(default=None, validation_alias=AliasChoices("failureCode", "failure_code"))
    safety_code: str | None = Field(default=None, validation_alias=AliasChoices("safetyCode", "safety_code"))
    policy_overrode_route: Route | None = Field(default=None, validation_alias=AliasChoices("policyOverrodeRoute", "policy_overrode_route"))
    shadow_suggested_route: Route | None = Field(default=None, validation_alias=AliasChoices("shadowSuggestedRoute", "shadow_suggested_route"))
    shadow_needs_fallback: bool | None = Field(default=None, validation_alias=AliasChoices("shadowNeedsFallback", "shadow_needs_fallback"))
    shadow_fallback_reason: str | None = Field(default=None, validation_alias=AliasChoices("shadowFallbackReason", "shadow_fallback_reason"))
    shadow_fused_share: float | None = Field(default=None, ge=0, le=1, validation_alias=AliasChoices("shadowFusedShare", "shadow_fused_share"))
    shadow_margin: float | None = Field(default=None, ge=0, le=1, validation_alias=AliasChoices("shadowMargin", "shadow_margin"))
    shadow_lane_agreement: bool | None = Field(default=None, validation_alias=AliasChoices("shadowLaneAgreement", "shadow_lane_agreement"))
    shadow_latency_ms: float | None = Field(default=None, ge=0, validation_alias=AliasChoices("shadowLatencyMs", "shadow_latency_ms"))
    routing_latency_ms: float = Field(ge=0, validation_alias=AliasChoices("routingLatencyMs", "routing_latency_ms"))
    routing_input_tokens: int = Field(default=0, ge=0, validation_alias=AliasChoices("routingInputTokens", "routing_input_tokens"))
    routing_output_tokens: int = Field(default=0, ge=0, validation_alias=AliasChoices("routingOutputTokens", "routing_output_tokens"))
    policy_code: str | None = Field(default=None, validation_alias=AliasChoices("policyCode", "policy_code"))


class RouteObservationExport(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        alias_generator=lambda name: "".join(
            word if index == 0 else word.capitalize()
            for index, word in enumerate(name.split("_"))
        ),
        populate_by_name=True
    )

    observation_id: UUID | None = None
    run_id: UUID
    event_id: int = Field(gt=0)
    workspace_id: UUID
    project_id: UUID
    occurred_at: datetime
    route_data: RouteObservationData
    routing_cost_usd: float = Field(ge=0)
    pricing_snapshot_id: UUID | None = None
    pricing_version: str | None = None
    cost_currency: str | None = None


class RouteGoldReview(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        alias_generator=lambda name: "".join(
            word if index == 0 else word.capitalize()
            for index, word in enumerate(name.split("_"))
        ),
        populate_by_name=True
    )

    run_id: UUID
    event_id: int = Field(gt=0)
    workspace_id: UUID
    gold_route: Route
    correction_source: CorrectionSource


class RouteReviewExportPage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        alias_generator=lambda name: "".join(
            word if index == 0 else word.capitalize()
            for index, word in enumerate(name.split("_"))
        ),
        populate_by_name=True
    )

    since: datetime
    until: datetime
    snapshot_at: datetime
    observations: list[RouteObservationExport]
    reviews: list[RouteGoldReview]
    next_occurred_at: datetime | None
    next_observation_id: UUID | None
    has_more: bool


class ShadowPreparationManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.1"] = "1.1"
    hash_key_version: str
    observation_count: int
    review_count: int
    matched_count: int
    missing_review_count: int
    orphan_review_count: int
    population_strata: dict[str, int]
    reviewed_strata: dict[str, int]
    weighting_method: str
    pricing_snapshot_ids: list[str]
    pricing_versions: list[str]
    cost_currency: str | None
    output_sha256: str


def _read_models(path: Path, model: type[BaseModel]) -> list[BaseModel]:
    return [model.model_validate_json(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _digest(key: bytes, namespace: str, value: str) -> str:
    return hmac.new(key, f"{namespace}:{value}".encode(), hashlib.sha256).hexdigest()


def _sampling_stratum(data: RouteObservationData) -> Literal["natural", "risk"]:
    risk_route = data.route in {"REACT_AGENT", "HUMAN_REQUIRED"}
    disagreement = data.shadow_suggested_route is not None and data.shadow_suggested_route != data.route
    return "risk" if risk_route or disagreement else "natural"


def prepare_shadow_traces(observation_path: Path, review_path: Path, output_path: Path, hash_key: str, hash_key_version: str = "test-v1") -> tuple[Path, Path]:
    observations = [RouteObservationExport.model_validate(item) for item in _read_models(observation_path, RouteObservationExport)]
    reviews = [RouteGoldReview.model_validate(item) for item in _read_models(review_path, RouteGoldReview)]
    return _prepare_shadow_models(observations, reviews, output_path, hash_key, hash_key_version)


def prepare_shadow_export_pages(page_path: Path, output_path: Path, hash_key: str, hash_key_version: str = "test-v1") -> tuple[Path, Path]:
    pages = [RouteReviewExportPage.model_validate(item) for item in _read_models(page_path, RouteReviewExportPage)]
    if not pages:
        raise ValueError("route review export page file is empty")
    cohort = (pages[0].since, pages[0].until, pages[0].snapshot_at)
    if any((page.since, page.until, page.snapshot_at) != cohort for page in pages):
        raise ValueError("route review export pages do not share one fixed cohort")
    if pages[-1].has_more:
        raise ValueError("route review export is incomplete; fetch the final page")
    if any(not page.has_more for page in pages[:-1]):
        raise ValueError("route review export contains pages after a terminal page")
    for page in pages:
        if not page.observations:
            if page.next_occurred_at is not None or page.next_observation_id is not None:
                raise ValueError("empty export page cannot advance the cursor")
            continue
        last = page.observations[-1]
        if page.next_occurred_at != last.occurred_at or page.next_observation_id != last.observation_id:
            raise ValueError("route review export cursor does not match the final observation")
    observations = [observation for page in pages for observation in page.observations]
    reviews = [review for page in pages for review in page.reviews]
    if any(item.observation_id is None for item in observations):
        raise ValueError("route review API export requires observationId on every row")
    ordered = [(item.occurred_at, str(item.observation_id)) for item in observations]
    if ordered != sorted(ordered):
        raise ValueError("route review export observations are not monotonically ordered")
    observation_keys = {(item.run_id, item.event_id) for item in observations}
    if any((item.run_id, item.event_id) not in observation_keys for item in reviews):
        raise ValueError("route review API export contains an orphan review")
    return _prepare_shadow_models(observations, reviews, output_path, hash_key, hash_key_version)


def _prepare_shadow_models(observations: list[RouteObservationExport], reviews: list[RouteGoldReview], output_path: Path, hash_key: str, hash_key_version: str) -> tuple[Path, Path]:
    if len(hash_key.encode()) < 32:
        raise ValueError("ROUTING_SHADOW_HASH_KEY must contain at least 32 bytes")
    if not hash_key_version.strip() or len(hash_key_version) > 100:
        raise ValueError("hash_key_version must contain 1-100 characters")
    observation_keys = [(item.run_id, item.event_id) for item in observations]
    review_keys = [(item.run_id, item.event_id) for item in reviews]
    currencies = {item.cost_currency for item in observations if item.cost_currency is not None}
    if currencies - {"USD"}:
        raise ValueError("routing evaluation currently requires USD pricing snapshots")
    if len(observation_keys) != len(set(observation_keys)):
        raise ValueError("observation run_id/event_id pairs must be unique")
    if len(review_keys) != len(set(review_keys)):
        raise ValueError("review run_id/event_id pairs must be unique")
    reviews_by_key = {key: item for key, item in zip(review_keys, reviews)}
    observation_key_set = set(observation_keys)
    key_bytes = hash_key.encode()
    population_strata = {"natural": 0, "risk": 0}
    reviewed_strata = {"natural": 0, "risk": 0}
    for observation in observations:
        stratum = _sampling_stratum(observation.route_data)
        population_strata[stratum] += 1
        if (observation.run_id, observation.event_id) in reviews_by_key:
            reviewed_strata[stratum] += 1
    for stratum, population_count in population_strata.items():
        if population_count > 0 and reviewed_strata[stratum] == 0:
            raise ValueError(f"review sample does not cover population stratum: {stratum}")
    traces: list[ShadowTrace] = []
    for observation in observations:
        review = reviews_by_key.get((observation.run_id, observation.event_id))
        if review is None:
            continue
        if review.workspace_id != observation.workspace_id:
            raise ValueError("review workspace does not match observation workspace")
        data = observation.route_data
        stratum = _sampling_stratum(data)
        inclusion_probability = reviewed_strata[stratum] / population_strata[stratum]
        policy_code = data.policy_code
        if policy_code is None and data.decision_source == "POLICY_GATE" and data.reason_codes:
            policy_code = data.reason_codes[0]
        traces.append(ShadowTrace(
            schema_version="1.1",
            trace_hash=_digest(key_bytes, "trace", f"{observation.run_id}:{observation.event_id}"),
            workspace_group_hash=_digest(key_bytes, "workspace", str(observation.workspace_id)),
            project_group_hash=_digest(key_bytes, "project", str(observation.project_id)),
            occurred_at=observation.occurred_at,
            final_route=data.route,
            shadow_suggested_route=data.shadow_suggested_route,
            shadow_needs_fallback=data.shadow_needs_fallback,
            shadow_fallback_reason=data.shadow_fallback_reason,
            shadow_fused_share=data.shadow_fused_share,
            shadow_margin=data.shadow_margin,
            shadow_lane_agreement=data.shadow_lane_agreement,
            gold_route=review.gold_route,
            correction_source=review.correction_source,
            llm_called=data.decision_source != "POLICY_GATE",
            routing_latency_ms=data.routing_latency_ms,
            shadow_latency_ms=data.shadow_latency_ms,
            routing_input_tokens=data.routing_input_tokens,
            routing_output_tokens=data.routing_output_tokens,
            routing_cost_usd=observation.routing_cost_usd,
            policy_code=policy_code,
            sampling_stratum=stratum,
            population_stratum_probability=population_strata[stratum] / len(observations),
            review_inclusion_probability=inclusion_probability,
            sample_weight=1 / inclusion_probability
        ))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("".join(f"{trace.model_dump_json()}\n" for trace in traces), encoding="utf-8")
    manifest = ShadowPreparationManifest(
        hash_key_version=hash_key_version,
        observation_count=len(observations),
        review_count=len(reviews),
        matched_count=len(traces),
        missing_review_count=len(observations) - len(traces),
        orphan_review_count=len(set(review_keys) - observation_key_set),
        population_strata=population_strata,
        reviewed_strata=reviewed_strata,
        weighting_method="inverse inclusion probability with holdout post-stratification",
        pricing_snapshot_ids=sorted({str(item.pricing_snapshot_id) for item in observations if item.pricing_snapshot_id}),
        pricing_versions=sorted({item.pricing_version for item in observations if item.pricing_version}),
        cost_currency="USD" if currencies else None,
        output_sha256=hashlib.sha256(output_path.read_bytes()).hexdigest()
    )
    manifest_path = output_path.with_suffix(".manifest.json")
    manifest_path.write_text(manifest.model_dump_json(indent=2), encoding="utf-8")
    return output_path, manifest_path
