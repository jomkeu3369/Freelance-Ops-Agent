from __future__ import annotations

import re
from pathlib import Path

RUNTIME_DIR = Path(__file__).resolve().parents[1] / "src" / "runtime"


def test_every_runtime_module_is_categorized_in_readme() -> None:
    readme = (RUNTIME_DIR / "README.md").read_text(encoding="utf-8")
    documented = set(re.findall(r"`([a-z0-9_]+\.py)`", readme))
    actual = {p.name for p in RUNTIME_DIR.glob("*.py") if p.name != "__init__.py"}

    assert documented == actual