from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class RoutingConfig:
    raw: dict[str, Any]
    root: Path

    def __getattr__(self, name: str) -> Any:
        try:
            return self.raw[name]
        except KeyError as error:
            raise AttributeError(name) from error


def load_config(path: str | Path) -> RoutingConfig:
    config_path = Path(path).resolve()
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    expected_routes = {
        "DIRECT_TOOL",
        "SIMPLE_LLM",
        "REACT_AGENT",
        "SUPERVISOR",
        "HUMAN_REQUIRED",
    }
    if set(raw["routes"]) != expected_routes:
        raise ValueError(f"Routes must be exactly {sorted(expected_routes)}")
    if raw["judges"]["models"] != ["gpt-5.6-luna"]:
        raise ValueError("The routing benchmark evaluator must be exactly gpt-5.6-luna")
    return RoutingConfig(raw=raw, root=config_path.parent)
