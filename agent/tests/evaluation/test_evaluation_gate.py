from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest


def _module() -> ModuleType:
    script = Path(__file__).parents[2] / "scripts" / "evaluation_gate.py"
    spec = importlib.util.spec_from_file_location("evaluation_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError("evaluation gate module could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_repository_release_policy_passes_pinned_candidate() -> None:
    module = _module()
    repository_root = Path(__file__).parents[3]
    result = module.evaluate_policy(
        repository_root,
        repository_root / "agent" / "evaluation" / "release-policy.json"
    )

    assert result["passed"] is True
    assert result["candidate"] == "B_prompt_llm"
    assert len(result["checks"]) == 5


def test_minimum_check_fails_regression() -> None:
    module = _module()

    result = module._minimum("accuracy", 0.74, 0.75)

    assert result["passed"] is False


def test_registry_rejects_shadow_only_candidate_for_operational_use() -> None:
    module = _module()
    policy = {
        "candidate_model": "local-model",
        "candidate_use": "OPERATIONAL_ROUTING"
    }
    registry = {
        "models": [
            {
                "id": "local-model",
                "status": "SHADOW_ONLY",
                "permitted_uses": ["ROUTING_DIAGNOSTIC"]
            }
        ]
    }

    with pytest.raises(ValueError, match="not approved"):
        module._require_approved_candidate(policy, registry)
