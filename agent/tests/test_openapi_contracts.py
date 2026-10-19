"""분리한 계약의 참조와 실제 준비 상태 응답을 대조한다."""

from collections.abc import Iterator
from functools import cache
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pytest
import yaml
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, ValidationError

from main import create_app

CONTRACT_ROOT = Path(__file__).resolve().parents[2] / "contracts/openapi"
ENTRY_POINTS = ("agent-internal-api.yaml", "spring-tool-api.yaml")


@cache
def _load_document(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _references(node: object) -> Iterator[str]:
    if isinstance(node, dict):
        if "$ref" in node:
            yield node["$ref"]
        for value in node.values():
            yield from _references(value)
    elif isinstance(node, list):
        for value in node:
            yield from _references(value)


def test_contract_references_resolve_locally_and_every_module_is_used() -> None:
    pending = [(CONTRACT_ROOT / name, "") for name in ENTRY_POINTS]
    visited: set[tuple[Path, str]] = set()
    while pending:
        source, pointer = pending.pop()
        if (source, pointer) in visited:
            continue
        visited.add((source, pointer))
        node = _load_document(source)
        for part in pointer.lstrip("/").split("/") if pointer else []:
            node = node[unquote(part).replace("~1", "/").replace("~0", "~")]
        for reference in _references(node):
            uri = urlsplit(reference)
            assert not uri.scheme and not uri.netloc and not uri.query, reference
            target = (source.parent / unquote(uri.path)).resolve() if uri.path else source
            assert CONTRACT_ROOT in target.parents, reference
            assert not uri.fragment or uri.fragment.startswith("/"), reference
            pending.append((target, uri.fragment))
    assert {path for path, _ in visited} == set(CONTRACT_ROOT.rglob("*.yaml"))


@pytest.mark.parametrize("ready", [False, True])
def test_readiness_response_matches_shared_contract(ready: bool) -> None:
    document = _load_document(CONTRACT_ROOT / ENTRY_POINTS[0])
    validator = Draft202012Validator(document["components"]["schemas"]["HealthResponse"])
    app = create_app()
    with TestClient(app) as client:
        app.state.runtime_ready = ready
        response = client.get("/health/readiness")
    assert response.status_code == (200 if ready else 503)
    validator.validate(response.json())


def test_health_contract_rejects_unknown_states() -> None:
    document = _load_document(CONTRACT_ROOT / ENTRY_POINTS[0])
    validator = Draft202012Validator(document["components"]["schemas"]["HealthResponse"])
    with pytest.raises(ValidationError):
        validator.validate({"status": "UNKNOWN", "service": "agent", "version": "0.1.0"})
