from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class BenchmarkConfig:
    raw: dict[str, Any]
    root: Path

    @property
    def dataset(self) -> dict[str, Any]:
        return self.raw["dataset"]

    @property
    def classifiers(self) -> list[dict[str, str]]:
        return self.raw["classifiers"]

    @property
    def training(self) -> dict[str, Any]:
        return self.raw["training"]

    @property
    def judges(self) -> dict[str, Any]:
        return self.raw["judges"]


def load_config(path: str | Path) -> BenchmarkConfig:
    config_path = Path(path).resolve()
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    required = {"dataset", "classifiers", "training", "judges"}
    missing = required - raw.keys()
    if missing:
        raise ValueError(f"Missing config sections: {sorted(missing)}")
    if len(raw["classifiers"]) != 2:
        raise ValueError("This A/B benchmark requires exactly two classifiers")
    if len(raw["judges"]["models"]) != 3:
        raise ValueError("Exactly three independent judge models are required")
    return BenchmarkConfig(raw=raw, root=config_path.parent)

