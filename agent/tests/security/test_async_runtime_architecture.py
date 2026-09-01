# ruff: noqa: E501, I001

from __future__ import annotations

import ast
from pathlib import Path

RUNTIME_ROOTS = (Path("src/runtime"), Path("src/infrastructure/database"))
FORBIDDEN_IMPORT_ROOTS = frozenset(("beanie", "faiss", "kafka", "pymongo", "redis", "tests"))


def production_python_files() -> list[Path]:
    return [path for root in RUNTIME_ROOTS for path in root.rglob("*.py")]


def test_async_runtime_does_not_depend_on_prototype_or_removed_infrastructure() -> None:
    violations: list[str] = []
    for path in production_python_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            modules = [alias.name for alias in node.names] if isinstance(node, ast.Import) else [node.module] if isinstance(node, ast.ImportFrom) and node.module is not None else []
            for module in modules:
                if module.split(".", maxsplit=1)[0] in FORBIDDEN_IMPORT_ROOTS:
                    violations.append(f"{path}:{node.lineno}:{module}")

    assert violations == []


def test_runtime_database_startup_never_creates_schema_implicitly() -> None:
    connection_source = Path("src/infrastructure/database/pgvector_connection.py").read_text(encoding="utf-8")
    open_method = connection_source.split("    async def open", maxsplit=1)[1].split("    async def close", maxsplit=1)[0]

    assert "create_all" not in open_method
    assert "create_runtime_tables" not in open_method
    assert "verify_runtime_tables" in connection_source
