from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from pathlib import Path

import numpy as np

if __package__:
    from .similarity_types import Chunk, Embedder, QueryCase
    from .text_chunks import tokenize
else:
    from similarity_types import Chunk, Embedder, QueryCase
    from text_chunks import tokenize


def normalize_rows(values: Sequence[Sequence[float]] | np.ndarray) -> np.ndarray:
    array = np.asarray(values, dtype=np.float32)
    if array.ndim != 2 or array.shape[0] == 0:
        raise ValueError("embedding은 비어 있지 않은 2차원 배열이어야 합니다.")
    norms = np.linalg.norm(array, axis=1, keepdims=True)
    if np.any(norms == 0):
        raise ValueError("0 벡터는 cosine similarity에 사용할 수 없습니다.")
    return np.ascontiguousarray(array / norms)


class HashingEmbedder:
    """외부 API 없이 처리 흐름을 확인하는 해시 임베딩. 의미 검색 품질 평가에는 쓰지 않는다."""

    def __init__(self, dimension: int = 384) -> None:
        self.dimension = dimension

    def _embed(self, text: str) -> list[float]:
        vector = np.zeros(self.dimension, dtype=np.float32)
        tokens = tokenize(text)
        features = tokens + [f"{a}::{b}" for a, b in zip(tokens, tokens[1:], strict=False)]
        for feature in features:
            digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
            number = int.from_bytes(digest, "little")
            vector[number % self.dimension] += 1.0 if number & 1 else -1.0
        if not np.any(vector):
            vector[0] = 1.0
        return vector.tolist()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._embed(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._embed(text)


class OpenAIEmbedder:
    """OpenAI 임베딩을 묶어 요청하고 로컬 캐시로 같은 입력의 재호출을 줄인다."""

    def __init__(self, *, model: str = "text-embedding-3-small", dimensions: int = 1536, cache_path: str | Path | None = None, price_per_million_tokens_usd: float = 0.02, batch_size: int = 128) -> None:  # noqa: E501
        from openai import OpenAI

        self.model = model
        self.dimensions = dimensions
        self.price_per_million_tokens_usd = price_per_million_tokens_usd
        self.batch_size = batch_size
        self.cache_path = Path(cache_path) if cache_path else None
        self.client = OpenAI()
        self.prompt_tokens = 0
        self.request_count = 0
        self.cache_hits = 0
        self._cache: dict[str, list[float]] = {}
        if self.cache_path and self.cache_path.exists():
            payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
            if payload.get("model") == model and payload.get("dimensions") == dimensions:
                self._cache = payload.get("embeddings", {})

    def _key(self, text: str) -> str:
        value = f"{self.model}\0{self.dimensions}\0{text}"
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def _save_cache(self) -> None:
        if not self.cache_path:
            return
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"model": self.model, "dimensions": self.dimensions, "embeddings": self._cache}
        self.cache_path.write_text(json.dumps(payload), encoding="utf-8")

    def _embed_many(self, texts: list[str]) -> list[list[float]]:
        keys = [self._key(text) for text in texts]
        missing_positions = [index for index, key in enumerate(keys) if key not in self._cache]
        for batch_start in range(0, len(missing_positions), self.batch_size):
            batch_positions = missing_positions[batch_start : batch_start + self.batch_size]
            missing_texts = [texts[index] for index in batch_positions]
            response = self.client.embeddings.create(
                model=self.model,
                input=missing_texts,
                dimensions=self.dimensions,
                encoding_format="float"
            )
            self.request_count += 1
            self.prompt_tokens += int(response.usage.prompt_tokens)
            for position, item in zip(batch_positions, response.data, strict=True):
                self._cache[keys[position]] = item.embedding
            self._save_cache()
        self.cache_hits += len(texts) - len(missing_positions)
        return [self._cache[key] for key in keys]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embed_many(texts)

    def embed_query(self, text: str) -> list[float]:
        return self._embed_many([text])[0]

    def usage_summary(self) -> dict[str, float | int | str]:
        return {
            "model": self.model,
            "dimensions": self.dimensions,
            "api_requests": self.request_count,
            "prompt_tokens": self.prompt_tokens,
            "cache_hits": self.cache_hits,
            "estimated_cost_usd": self.prompt_tokens
            / 1_000_000
            * self.price_per_million_tokens_usd,
        }


def embed_corpus(chunks: Sequence[Chunk], embedder: Embedder) -> np.ndarray:
    return normalize_rows(embedder.embed_documents([chunk.text for chunk in chunks]))


def embed_queries(cases: Sequence[QueryCase], embedder: Embedder) -> np.ndarray:
    return normalize_rows(embedder.embed_documents([case.query for case in cases]))
