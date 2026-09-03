"""Validate deployment-pinned readiness evidence before starting the limited pilot."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from . import research_pilot_readiness as readiness
from .runtime_operational_metrics import RuntimeOperationalSnapshot


class PilotActivationManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    deployment_commit_sha: str = Field(pattern="^[0-9a-f]{40}$")
    resource_pool: str
    workspace_ids: list[UUID] = Field(min_length=1, max_length=5)
    created_at: datetime
    expires_at: datetime
    evidence: readiness.ResearchPilotDrillEvidence


def require_pilot_activation(path: str, expected_sha256: str, deployment_commit_sha: str, workspace_ids: frozenset[UUID], snapshot: RuntimeOperationalSnapshot, *, now: datetime | None = None) -> None:  # noqa: E501
    if not path or len(expected_sha256) != 64 or len(deployment_commit_sha) != 40:
        raise ValueError("FIFO pilot requires pinned readiness evidence and deployment identity")
    # The manifest must be mounted read-only by trusted deployment tooling, never supplied by a request.
    with Path(path).open("rb") as source:
        content = source.read(65_537)
    if len(content) > 65_536 or hashlib.sha256(content).hexdigest() != expected_sha256:
        raise ValueError("FIFO pilot readiness evidence hash or size is invalid")
    manifest = PilotActivationManifest.model_validate_json(content, strict=True)
    current = now or datetime.now(UTC)
    times = (manifest.created_at, manifest.expires_at, current, snapshot.captured_at)
    if any(value.tzinfo is None or value.utcoffset() is None for value in times):
        raise ValueError("FIFO pilot evidence timestamps must be timezone-aware")
    if not manifest.created_at <= current < manifest.expires_at or manifest.expires_at - manifest.created_at > timedelta(days=1):  # noqa: E501
        raise ValueError("FIFO pilot readiness evidence is expired or not yet valid")
    if not timedelta(0) <= current - snapshot.captured_at <= timedelta(minutes=1):
        raise ValueError("FIFO pilot operational snapshot is stale")
    if manifest.deployment_commit_sha != deployment_commit_sha or manifest.resource_pool != snapshot.resource_pool:
        raise ValueError("FIFO pilot evidence does not match deployment scope")
    if len(set(manifest.workspace_ids)) != len(manifest.workspace_ids) or set(manifest.workspace_ids) != workspace_ids:
        raise ValueError("FIFO pilot evidence does not match workspace allowlist")
    report = readiness.ResearchPilotReadinessGate().evaluate(snapshot, manifest.evidence)
    if report.status is not readiness.ResearchPilotReadinessStatus.READY_FOR_LIMITED_PILOT:
        raise ValueError("FIFO pilot readiness rejected: " + ", ".join(report.reasons))
