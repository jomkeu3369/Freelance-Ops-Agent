from __future__ import annotations

import hashlib
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest

from runtime.research_pilot_activation import PilotActivationManifest, require_pilot_activation
from runtime.research_pilot_readiness import ResearchPilotDrillEvidence
from runtime.runtime_operational_metrics import RuntimeOperationalSnapshot


def manifest() -> PilotActivationManifest:
    now = datetime.now(UTC)
    evidence = ResearchPilotDrillEvidence(True, True, True, True, True, True, True, True, True, 0, 0, 1, 1, 1)
    return PilotActivationManifest(deployment_commit_sha="a" * 40, resource_pool="research-read-v1", workspace_ids=[uuid4()], created_at=now, expires_at=now + timedelta(hours=1), evidence=evidence)  # noqa: E501


@pytest.mark.parametrize("case", ["valid", "hash", "scope", "commit", "expired", "drill", "live_lease", "stale_snapshot", "missing"])  # noqa: E501
def test_activation_requires_pinned_fresh_scope_matched_evidence(tmp_path: Path, case: str) -> None:
    document = manifest()
    now = document.created_at
    if case == "expired":
        document.expires_at = now
    if case == "drill":
        document.evidence = replace(document.evidence, restart_recovery_passed=False)
    path = tmp_path / "readiness.json"
    data = document.model_dump_json().encode()
    path.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest() if case != "hash" else "b" * 64
    snapshot = RuntimeOperationalSnapshot("research-read-v1", now, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    if case == "live_lease":
        snapshot = replace(snapshot, expired_lease_count=1)
    if case == "stale_snapshot":
        snapshot = replace(snapshot, captured_at=now - timedelta(minutes=2))
    scope = frozenset([uuid4()]) if case == "scope" else frozenset(document.workspace_ids)
    commit = "b" * 40 if case == "commit" else document.deployment_commit_sha
    selected_path = str(tmp_path / "missing.json") if case == "missing" else str(path)
    if case == "valid":
        require_pilot_activation(selected_path, digest, commit, scope, snapshot, now=now)
    else:
        with pytest.raises((ValueError, OSError)):
            require_pilot_activation(selected_path, digest, commit, scope, snapshot, now=now)


def test_activation_manifest_rejects_truthy_string_instead_of_boolean() -> None:
    data = manifest().model_dump_json().replace('"restart_recovery_passed":true', '"restart_recovery_passed":"false"')
    with pytest.raises(ValueError):
        PilotActivationManifest.model_validate_json(data, strict=True)
