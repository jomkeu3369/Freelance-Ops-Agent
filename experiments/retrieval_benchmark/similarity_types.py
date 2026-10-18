from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

import numpy as np


class Embedder(Protocol):
    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


@dataclass(slots=True)
class Chunk:
    chunk_id: str
    document_id: str
    text: str
    chunk_index: int
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class QueryCase:
    case_id: str
    query: str
    split: str
    answerable: bool
    relevant_document_ids: tuple[str, ...] = ()
    llm_accept: bool | None = None
    category: str = "uncategorized"


@dataclass(slots=True)
class ClusterResult:
    labels: np.ndarray
    centroids: np.ndarray
    radii: np.ndarray
    chosen_k: int
    silhouette: float
    candidates: list[dict[str, float | int]]


@dataclass(slots=True)
class LinearGate:
    feature_names: tuple[str, ...]
    mean: np.ndarray
    scale: np.ndarray
    weights: np.ndarray
    bias: float

    def predict_proba(self, rows: Sequence[dict[str, float]]) -> np.ndarray:
        x = np.asarray(
            [[row[name] for name in self.feature_names] for row in rows], dtype=np.float64
        )
        z = ((x - self.mean) / self.scale) @ self.weights + self.bias
        z = np.clip(z, -30.0, 30.0)
        return 1.0 / (1.0 + np.exp(-z))
