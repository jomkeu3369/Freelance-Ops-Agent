"""Fail CI when a pinned routing candidate regresses below release policy."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--repository-root", type=Path, default=Path.cwd())
    args = parser.parse_args()

    result = evaluate_policy(args.repository_root.resolve(), args.policy.resolve())
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if result["passed"] else 1


def evaluate_policy(repository_root: Path, policy_path: Path) -> dict[str, Any]:
    policy = _object(json.loads(policy_path.read_text(encoding="utf-8")), "policy")
    registry_path = repository_root / _string(policy, "registry")
    registry = _object(json.loads(registry_path.read_text(encoding="utf-8")), "model registry")
    _require_approved_candidate(policy, registry)
    report_path = repository_root / _string(policy, "report")
    report = _object(json.loads(report_path.read_text(encoding="utf-8")), "report")
    routers = report.get("routers")
    if not isinstance(routers, list):
        raise ValueError("report routers must be a list")

    candidate_name = _string(policy, "candidate_name")
    candidate = next(
        (item for item in routers if isinstance(item, dict) and item.get("name") == candidate_name),
        None
    )
    if candidate is None:
        raise ValueError(f"candidate is missing from report: {candidate_name}")
    if candidate.get("model_id") != _string(policy, "candidate_model"):
        raise ValueError("candidate model does not match the pinned release policy")

    metrics = _object(candidate.get("metrics"), "candidate metrics")
    minimum = _object(policy.get("minimum"), "minimum")
    maximum = _object(policy.get("maximum"), "maximum")
    human_metrics = _object(
        _object(metrics.get("per_route"), "per_route").get("HUMAN_REQUIRED"),
        "HUMAN_REQUIRED metrics"
    )
    checks = [
        _minimum("accuracy", metrics.get("accuracy"), minimum.get("accuracy")),
        _minimum("macro_f1", metrics.get("macro_f1"), minimum.get("macro_f1")),
        _minimum(
            "human_required_recall",
            human_metrics.get("recall"),
            minimum.get("human_required_recall")
        ),
        _maximum("p95_ms", metrics.get("p95_ms"), maximum.get("p95_ms")),
        _maximum(
            "cost_usd_per_50_cases",
            metrics.get("total_cost_usd"),
            maximum.get("cost_usd_per_50_cases")
        )
    ]
    return {
        "schema_version": "1.0",
        "policy_version": _string(policy, "policy_version"),
        "registry_version": _string(registry, "registry_version"),
        "candidate": candidate_name,
        "model": candidate.get("model_id"),
        "report": str(report_path.relative_to(repository_root)).replace("\\", "/"),
        "passed": all(check["passed"] for check in checks),
        "checks": checks,
        "known_limitations": policy.get("known_limitations", [])
    }


def _require_approved_candidate(policy: dict[str, Any], registry: dict[str, Any]) -> None:
    models = registry.get("models")
    if not isinstance(models, list):
        raise ValueError("model registry models must be a list")
    candidate_model = _string(policy, "candidate_model")
    candidate_use = _string(policy, "candidate_use")
    registered = next(
        (item for item in models if isinstance(item, dict) and item.get("id") == candidate_model),
        None
    )
    if registered is None or registered.get("status") != "APPROVED":
        raise ValueError("release candidate is not approved in the model registry")
    permitted_uses = registered.get("permitted_uses")
    if not isinstance(permitted_uses, list) or candidate_use not in permitted_uses:
        raise ValueError("release candidate is not approved for the requested use")


def _minimum(name: str, actual: object, threshold: object) -> dict[str, object]:
    actual_number = _number(actual, name)
    threshold_number = _number(threshold, f"minimum.{name}")
    return {
        "metric": name,
        "operator": ">=",
        "actual": actual_number,
        "threshold": threshold_number,
        "passed": actual_number >= threshold_number
    }


def _maximum(name: str, actual: object, threshold: object) -> dict[str, object]:
    actual_number = _number(actual, name)
    threshold_number = _number(threshold, f"maximum.{name}")
    return {
        "metric": name,
        "operator": "<=",
        "actual": actual_number,
        "threshold": threshold_number,
        "passed": actual_number <= threshold_number
    }


def _object(value: object, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")
    return value


def _string(values: dict[str, Any], name: str) -> str:
    value = values.get(name)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a non-empty string")
    return value


def _number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"{name} must be numeric")
    return float(value)


if __name__ == "__main__":
    raise SystemExit(main())
