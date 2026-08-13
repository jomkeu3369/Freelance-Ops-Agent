from __future__ import annotations

import ast
import re
from pathlib import Path

import yaml

from main import create_app

AGENT_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = AGENT_ROOT.parent
RAW_SQL = re.compile(r"^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE)\b", re.IGNORECASE)


def test_operational_source_contains_no_authored_raw_sql() -> None:
    violations: list[str] = []
    for path in (AGENT_ROOT / "src").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and RAW_SQL.match(node.value):
                violations.append(f"{path.relative_to(AGENT_ROOT)}:{node.lineno}")
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "text":
                violations.append(f"{path.relative_to(AGENT_ROOT)}:{node.lineno}")

    assert violations == []


def test_versioned_contract_covers_every_fastapi_internal_path() -> None:
    contract = yaml.safe_load(
        (REPOSITORY_ROOT / "contracts/openapi/agent-internal-api.yaml").read_text(encoding="utf-8")
    )
    contract_paths = set(contract["paths"])
    application_paths = {
        path.replace("{run_id}", "{runId}")
        for path in create_app().openapi()["paths"]
        if path.startswith("/internal/")
    }

    assert application_paths <= contract_paths


def test_agent_container_uses_flat_source_entrypoint() -> None:
    dockerfile = (AGENT_ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert '"main:app", "--app-dir", "src"' in dockerfile
    assert "freelance_ops_agent.main" not in dockerfile
