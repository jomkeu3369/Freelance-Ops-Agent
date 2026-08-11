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

    if raw["router_b"]["model_id"] != "gpt-5.6-luna":
        raise ValueError("Router B must be gpt-5.6-luna")
    judges = raw["judges"]["models"]
    if len(judges) != 3 or len(set(judges)) != 3:
        raise ValueError("Exactly three distinct judge models are required")
    if raw["router_b"]["model_id"] in judges:
        raise ValueError("Router B cannot also evaluate its own predictions")

    return RoutingConfig(raw=raw, root=config_path.parent)
