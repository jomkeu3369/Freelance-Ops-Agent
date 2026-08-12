from __future__ import annotations

import hashlib
import json
import math
import re
import time
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import numpy as np

TOKEN_PATTERN = re.compile(r"[가-힣A-Za-z0-9_]+")


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
        x = np.asarray([[row[name] for name in self.feature_names] for row in rows], dtype=np.float64)
        z = ((x - self.mean) / self.scale) @ self.weights + self.bias
        z = np.clip(z, -30.0, 30.0)
        return 1.0 / (1.0 + np.exp(-z))


def normalize_rows(values: Sequence[Sequence[float]] | np.ndarray) -> np.ndarray:
    array = np.asarray(values, dtype=np.float32)
    if array.ndim != 2 or array.shape[0] == 0:
        raise ValueError("embedding은 비어 있지 않은 2차원 배열이어야 합니다.")
    norms = np.linalg.norm(array, axis=1, keepdims=True)
    if np.any(norms == 0):
        raise ValueError("0 벡터는 cosine similarity에 사용할 수 없습니다.")
    return np.ascontiguousarray(array / norms)


def tokenize(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_PATTERN.findall(text)]


def read_text(path: str | Path) -> str:
    source = Path(path)
    suffix = source.suffix.lower()
    if suffix == ".txt":
        return source.read_text(encoding="utf-8")
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise RuntimeError("PDF 처리를 위해 `uv add pypdf`가 필요합니다.") from exc
        pages = [page.extract_text() or "" for page in PdfReader(source).pages]
        return "\n\n".join(pages)
    raise ValueError(f"지원하지 않는 확장자입니다: {suffix}; .txt와 .pdf만 허용합니다.")


def chunk_text(text: str, chunk_size: int = 600, overlap: int = 200) -> list[str]:
    if chunk_size <= 0 or overlap < 0 or overlap >= chunk_size:
        raise ValueError("0 <= overlap < chunk_size 조건이어야 합니다.")
    normalized = re.sub(r"\r\n?", "\n", text).strip()
    if not normalized:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        hard_end = min(start + chunk_size, len(normalized))
        end = hard_end
        if hard_end < len(normalized):
            candidates = [
                normalized.rfind("\n\n", start, hard_end),
                normalized.rfind(". ", start, hard_end),
                normalized.rfind("다. ", start, hard_end),
                normalized.rfind(" ", start, hard_end),
            ]
            boundary = max(candidates)
            if boundary >= start + chunk_size // 2:
                end = boundary + (1 if normalized[boundary] == " " else 2)
        piece = normalized[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(normalized):
            break
        start = max(start + 1, end - overlap)
    return chunks


def chunks_from_texts(
    documents: dict[str, str],
    *,
    workspace_id: str = "offline-eval",
    chunk_size: int = 600,
    overlap: int = 200,
) -> list[Chunk]:
    result: list[Chunk] = []
    seen_hashes: set[str] = set()
    for document_id, text in documents.items():
        pieces = chunk_text(text, chunk_size=chunk_size, overlap=overlap)
        for index, piece in enumerate(pieces):
            content_hash = hashlib.sha256(piece.encode("utf-8")).hexdigest()
            if content_hash in seen_hashes:
                continue
            seen_hashes.add(content_hash)
            result.append(
                Chunk(
                    chunk_id=f"{document_id}:{index}:{content_hash[:10]}",
                    document_id=document_id,
                    text=piece,
                    chunk_index=index,
                    metadata={
                        "workspace_id": workspace_id,
                        "content_hash": content_hash,
                        "total_chunks": len(pieces),
                    },
                )
            )
    if not result:
        raise ValueError("청킹 결과가 없습니다.")
    return result


def chunks_from_paths(
    paths: Iterable[str | Path],
    *,
    workspace_id: str,
    chunk_size: int = 600,
    overlap: int = 200,
) -> list[Chunk]:
    documents: dict[str, str] = {}
    for raw_path in paths:
        path = Path(raw_path)
        digest = hashlib.sha256(str(path.resolve()).encode("utf-8")).hexdigest()[:10]
        documents[f"{path.stem}-{digest}"] = read_text(path)
    return chunks_from_texts(
        documents,
        workspace_id=workspace_id,
        chunk_size=chunk_size,
        overlap=overlap,
    )


class HashingEmbedder:
    """API 호출 없이 노트북 동작만 확인하는 smoke-test 전용 embedder입니다."""

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
    """OpenAI embedding을 batch 호출하고 demo 재실행을 로컬 cache로 보호합니다."""

    def __init__(
        self,
        *,
        model: str = "text-embedding-3-small",
        dimensions: int = 1536,
        cache_path: str | Path | None = None,
        price_per_million_tokens_usd: float = 0.02,
        batch_size: int = 128,
    ) -> None:
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
        payload = {
            "model": self.model,
            "dimensions": self.dimensions,
            "embeddings": self._cache,
        }
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
                encoding_format="float",
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
            "estimated_cost_usd": self.prompt_tokens / 1_000_000 * self.price_per_million_tokens_usd,
        }


def embed_corpus(chunks: Sequence[Chunk], embedder: Embedder) -> np.ndarray:
    return normalize_rows(embedder.embed_documents([chunk.text for chunk in chunks]))


def embed_queries(cases: Sequence[QueryCase], embedder: Embedder) -> np.ndarray:
    return normalize_rows(embedder.embed_documents([case.query for case in cases]))


def _spherical_kmeans_once(
    vectors: np.ndarray,
    k: int,
    *,
    seed: int,
    max_iter: int = 100,
) -> tuple[np.ndarray, np.ndarray, float]:
    rng = np.random.default_rng(seed)
    first = int(rng.integers(len(vectors)))
    centers = [vectors[first]]
    while len(centers) < k:
        similarities = vectors @ np.asarray(centers).T
        distances = np.maximum(0.0, 1.0 - similarities.max(axis=1))
        total = float(distances.sum())
        index = int(rng.integers(len(vectors))) if total == 0 else int(rng.choice(len(vectors), p=distances / total))
        centers.append(vectors[index])
    centroids = normalize_rows(np.asarray(centers))
    labels = np.full(len(vectors), -1, dtype=np.int32)
    for _ in range(max_iter):
        new_labels = np.argmax(vectors @ centroids.T, axis=1).astype(np.int32)
        if np.array_equal(labels, new_labels):
            break
        labels = new_labels
        updated = []
        for cluster_id in range(k):
            members = vectors[labels == cluster_id]
            if len(members) == 0:
                updated.append(vectors[int(rng.integers(len(vectors)))])
            else:
                updated.append(members.mean(axis=0))
        centroids = normalize_rows(np.asarray(updated))
    objective = float(np.sum(1.0 - np.sum(vectors * centroids[labels], axis=1)))
    return labels, centroids, objective


def spherical_kmeans(
    vectors: np.ndarray,
    k: int,
    *,
    seed: int = 42,
    n_init: int = 8,
) -> tuple[np.ndarray, np.ndarray]:
    attempts = [_spherical_kmeans_once(vectors, k, seed=seed + attempt) for attempt in range(n_init)]
    labels, centroids, _ = min(attempts, key=lambda item: item[2])
    return labels, centroids


def cosine_silhouette(vectors: np.ndarray, labels: np.ndarray) -> float:
    unique = np.unique(labels)
    if len(unique) < 2 or len(unique) >= len(vectors):
        return 0.0
    distances = np.maximum(0.0, 1.0 - vectors @ vectors.T)
    values: list[float] = []
    for index, label in enumerate(labels):
        same = np.flatnonzero(labels == label)
        same = same[same != index]
        if len(same) == 0:
            values.append(0.0)
            continue
        a = float(distances[index, same].mean())
        b = min(float(distances[index, labels == other].mean()) for other in unique if other != label)
        values.append((b - a) / max(a, b, 1e-12))
    return float(np.mean(values))


def select_clusters(
    vectors: np.ndarray,
    *,
    max_k: int = 12,
    min_cluster_size: int = 2,
    min_silhouette: float = 0.05,
    seed: int = 42,
) -> ClusterResult:
    count = len(vectors)
    upper = min(max_k, count - 1, count // min_cluster_size)
    candidates: list[dict[str, float | int]] = []
    best: tuple[float, np.ndarray, np.ndarray] | None = None
    for k in range(2, upper + 1):
        labels, centroids = spherical_kmeans(vectors, k, seed=seed)
        sizes = np.bincount(labels, minlength=k)
        if int(sizes.min()) < min_cluster_size:
            continue
        silhouette = cosine_silhouette(vectors, labels)
        candidates.append({"k": k, "silhouette": silhouette, "min_cluster_size": int(sizes.min())})
        if best is None or silhouette > best[0]:
            best = (silhouette, labels, centroids)
    if best is None or best[0] < min_silhouette:
        labels = np.zeros(count, dtype=np.int32)
        centroids = normalize_rows([vectors.mean(axis=0)])
        silhouette = 0.0
    else:
        silhouette, labels, centroids = best
    radii = np.zeros(len(centroids), dtype=np.float32)
    for cluster_id, centroid in enumerate(centroids):
        member_distances = 1.0 - vectors[labels == cluster_id] @ centroid
        radii[cluster_id] = float(np.quantile(member_distances, 0.9)) if len(member_distances) else 0.0
    return ClusterResult(
        labels=labels,
        centroids=centroids,
        radii=radii,
        chosen_k=len(centroids),
        silhouette=float(silhouette),
        candidates=candidates,
    )


class BM25Index:
    def __init__(self, texts: Sequence[str], *, k1: float = 1.5, b: float = 0.75) -> None:
        self.k1 = k1
        self.b = b
        self.tokens = [tokenize(text) for text in texts]
        self.lengths = np.asarray([len(tokens) for tokens in self.tokens], dtype=np.float64)
        self.avg_length = float(self.lengths.mean()) if len(self.lengths) else 1.0
        document_frequency: Counter[str] = Counter()
        for tokens in self.tokens:
            document_frequency.update(set(tokens))
        count = len(self.tokens)
        self.idf = {
            token: math.log(1.0 + (count - frequency + 0.5) / (frequency + 0.5))
            for token, frequency in document_frequency.items()
        }
        self.term_frequencies = [Counter(tokens) for tokens in self.tokens]

    def score(self, query: str) -> np.ndarray:
        scores = np.zeros(len(self.tokens), dtype=np.float64)
        for token in set(tokenize(query)):
            idf = self.idf.get(token)
            if idf is None:
                continue
            for index, frequencies in enumerate(self.term_frequencies):
                frequency = frequencies.get(token, 0)
                denominator = frequency + self.k1 * (
                    1.0 - self.b + self.b * self.lengths[index] / max(self.avg_length, 1.0)
                )
                if denominator:
                    scores[index] += idf * frequency * (self.k1 + 1.0) / denominator
        return scores


def _deduplicated_top_indices(
    semantic_scores: np.ndarray,
    chunks: Sequence[Chunk],
    *,
    k: int,
    adjacent_window: int = 1,
) -> list[int]:
    selected: list[int] = []
    for index in np.argsort(-semantic_scores):
        chunk = chunks[int(index)]
        duplicate = any(
            chunks[chosen].document_id == chunk.document_id
            and abs(chunks[chosen].chunk_index - chunk.chunk_index) <= adjacent_window
            for chosen in selected
        )
        if not duplicate:
            selected.append(int(index))
        if len(selected) == k:
            break
    return selected


FEATURE_NAMES = (
    "s1",
    "s2",
    "s3",
    "top3_mean",
    "top3_min",
    "semantic_gap",
    "semantic_dispersion",
    "bm25_top",
    "bm25_mean3",
    "centroid_similarity",
    "cluster_margin",
    "cluster_agreement",
    "centroid_radius_ratio",
    "distinct_documents",
)


def extract_features(
    query: str,
    query_vector: np.ndarray,
    chunks: Sequence[Chunk],
    corpus_vectors: np.ndarray,
    clusters: ClusterResult,
    bm25: BM25Index,
    *,
    top_k: int = 3,
) -> tuple[dict[str, float], list[int]]:
    semantic = corpus_vectors @ query_vector
    selected = _deduplicated_top_indices(semantic, chunks, k=min(top_k, len(chunks)))
    top_semantic = [float(semantic[index]) for index in selected]
    while len(top_semantic) < 3:
        top_semantic.append(top_semantic[-1] if top_semantic else -1.0)
    lexical = bm25.score(query)
    lexical_top = sorted((float(value) for value in lexical), reverse=True)[:3]
    while len(lexical_top) < 3:
        lexical_top.append(0.0)
    centroid_scores = clusters.centroids @ query_vector
    centroid_order = np.argsort(-centroid_scores)
    nearest_cluster = int(centroid_order[0])
    centroid_distance = max(0.0, 1.0 - float(centroid_scores[nearest_cluster]))
    radius = max(float(clusters.radii[nearest_cluster]), 1e-6)
    selected_labels = clusters.labels[selected]
    agreement = float(np.mean(selected_labels == nearest_cluster)) if selected else 0.0
    cluster_margin = (
        float(centroid_scores[centroid_order[0]] - centroid_scores[centroid_order[1]])
        if len(centroid_order) > 1
        else 0.0
    )
    row = {
        "s1": top_semantic[0],
        "s2": top_semantic[1],
        "s3": top_semantic[2],
        "top3_mean": float(np.mean(top_semantic[:3])),
        "top3_min": min(top_semantic[:3]),
        "semantic_gap": top_semantic[0] - top_semantic[2],
        "semantic_dispersion": float(np.std(top_semantic[:3])),
        "bm25_top": lexical_top[0] / (1.0 + lexical_top[0]),
        "bm25_mean3": float(np.mean(lexical_top)) / (1.0 + float(np.mean(lexical_top))),
        "centroid_similarity": float(centroid_scores[nearest_cluster]),
        "cluster_margin": cluster_margin,
        "cluster_agreement": agreement,
        "centroid_radius_ratio": centroid_distance / radius,
        "distinct_documents": float(len({chunks[index].document_id for index in selected})) / max(len(selected), 1),
    }
    return row, selected


def fit_linear_gate(
    rows: Sequence[dict[str, float]],
    labels: Sequence[bool],
    feature_names: Sequence[str],
    *,
    learning_rate: float = 0.05,
    steps: int = 2_000,
    l2: float = 0.01,
) -> LinearGate:
    x = np.asarray([[row[name] for name in feature_names] for row in rows], dtype=np.float64)
    y = np.asarray(labels, dtype=np.float64)
    if len(np.unique(y)) < 2:
        raise ValueError("학습 split에는 answerable=True/False 사례가 모두 필요합니다.")
    mean = x.mean(axis=0)
    scale = x.std(axis=0)
    scale[scale < 1e-8] = 1.0
    standardized = (x - mean) / scale
    weights = np.zeros(standardized.shape[1], dtype=np.float64)
    bias = 0.0
    for _ in range(steps):
        logits = np.clip(standardized @ weights + bias, -30.0, 30.0)
        probabilities = 1.0 / (1.0 + np.exp(-logits))
        error = probabilities - y
        weights -= learning_rate * ((standardized.T @ error) / len(y) + l2 * weights)
        bias -= learning_rate * float(error.mean())
    return LinearGate(tuple(feature_names), mean, scale, weights, bias)


def choose_threshold(
    labels: Sequence[bool],
    scores: Sequence[float],
    *,
    max_false_accept_rate: float = 0.10,
) -> float:
    y = np.asarray(labels, dtype=bool)
    probabilities = np.asarray(scores, dtype=np.float64)
    candidates = np.unique(np.concatenate(([0.0], probabilities, [1.0 + 1e-9])))
    feasible: list[tuple[float, float, float]] = []
    negatives = max(int((~y).sum()), 1)
    for threshold in candidates:
        accepted = probabilities >= threshold
        tp = int(np.sum(accepted & y))
        fp = int(np.sum(accepted & ~y))
        fn = int(np.sum(~accepted & y))
        precision = tp / max(tp + fp, 1)
        recall = tp / max(tp + fn, 1)
        f1 = 2.0 * precision * recall / max(precision + recall, 1e-12)
        false_accept_rate = fp / negatives
        if false_accept_rate <= max_false_accept_rate:
            feasible.append((f1, recall, float(threshold)))
    if not feasible:
        return float(probabilities.max() + 1e-9)
    return max(feasible, key=lambda item: (item[0], item[1], item[2]))[2]


def classification_metrics(
    labels: Sequence[bool],
    scores: Sequence[float],
    threshold: float,
) -> dict[str, float | int]:
    y = np.asarray(labels, dtype=bool)
    probabilities = np.asarray(scores, dtype=np.float64)
    accepted = probabilities >= threshold
    tp = int(np.sum(accepted & y))
    fp = int(np.sum(accepted & ~y))
    tn = int(np.sum(~accepted & ~y))
    fn = int(np.sum(~accepted & y))
    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    return {
        "n": len(y),
        "threshold": threshold,
        "accuracy": (tp + tn) / max(len(y), 1),
        "precision": precision,
        "recall": recall,
        "f1": 2.0 * precision * recall / max(precision + recall, 1e-12),
        "coverage": float(accepted.mean()) if len(accepted) else 0.0,
        "false_accept_rate": fp / max(int((~y).sum()), 1),
        "false_reject_rate": fn / max(int(y.sum()), 1),
        "brier": float(np.mean((probabilities - y.astype(float)) ** 2)),
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
    }


def retrieval_metrics(
    cases: Sequence[QueryCase],
    retrieved: Sequence[Sequence[int]],
    chunks: Sequence[Chunk],
) -> dict[str, float]:
    recalls: list[float] = []
    evidence_coverages: list[float] = []
    reciprocal_ranks: list[float] = []
    
    for case, indices in zip(cases, retrieved, strict=True):
        relevant = set(case.relevant_document_ids)
        if not relevant:
            continue
        
        ranked_documents = [chunks[index].document_id for index in indices]
        recalls.append(float(any(document_id in relevant for document_id in ranked_documents)))
        evidence_coverages.append(len(relevant.intersection(ranked_documents)) / len(relevant))
        rank = next((rank for rank, document_id in enumerate(ranked_documents, 1) if document_id in relevant), None)
        reciprocal_ranks.append(0.0 if rank is None else 1.0 / rank)
    
    return {
        "recall_at_3": float(np.mean(recalls)) if recalls else float("nan"),
        "evidence_coverage_at_3": float(np.mean(evidence_coverages)) if evidence_coverages else float("nan"),
        "mrr": float(np.mean(reciprocal_ranks)) if reciprocal_ranks else float("nan"),
    }


METHOD_FEATURES: dict[str, tuple[str, ...]] = {
    "A_top1": ("s1",),
    "B_top3_mean": ("top3_mean",),
    "C_semantic_bm25": ("s1", "top3_mean", "bm25_top", "bm25_mean3"),
    "D_plus_cluster": (
        "s1",
        "top3_mean",
        "bm25_top",
        "centroid_similarity",
        "cluster_margin",
        "cluster_agreement",
        "centroid_radius_ratio",
    ),
    "E_calibrated_gate": FEATURE_NAMES,
}


def run_benchmark(
    chunks: Sequence[Chunk],
    corpus_vectors: np.ndarray,
    cases: Sequence[QueryCase],
    query_vectors: np.ndarray,
    *,
    clusters: ClusterResult | None = None,
    max_false_accept_rate: float = 0.10,
    uncertain_band: float = 0.10,
) -> dict[str, Any]:
    if len(cases) != len(query_vectors):
        raise ValueError("case 수와 query embedding 수가 다릅니다.")
    
    required = {"train", "validation", "test"}
    actual = {case.split for case in cases}
    
    if not required.issubset(actual):
        raise ValueError("train, validation, test split이 모두 필요합니다.")
    
    clusters = clusters or select_clusters(corpus_vectors)
    
    bm25 = BM25Index([chunk.text for chunk in chunks])
    rows: list[dict[str, float]] = []
    retrieved: list[list[int]] = []
    feature_started = time.perf_counter()
    
    for case, query_vector in zip(cases, query_vectors, strict=True):
        row, indices = extract_features(case.query, query_vector, chunks, corpus_vectors, clusters, bm25)
        rows.append(row)
        retrieved.append(indices)
    
    feature_ms = (time.perf_counter() - feature_started) * 1_000.0
    indices_by_split = {split: [index for index, case in enumerate(cases) if case.split == split] for split in required}
    
    results: list[dict[str, Any]] = []
    method_details: dict[str, dict[str, Any]] = {}
    gates: dict[str, LinearGate] = {}
    test_probabilities: dict[str, np.ndarray] = {}
    
    for method, feature_names in METHOD_FEATURES.items():
        train_indices = indices_by_split["train"]
        validation_indices = indices_by_split["validation"]
        test_indices = indices_by_split["test"]
       
        gate = fit_linear_gate(
            [rows[index] for index in train_indices],
            [cases[index].answerable for index in train_indices],
            feature_names,
        )
        validation_scores = gate.predict_proba([rows[index] for index in validation_indices])
        threshold = choose_threshold(
            [cases[index].answerable for index in validation_indices],
            validation_scores,
            max_false_accept_rate=max_false_accept_rate,
        )
        test_scores = gate.predict_proba([rows[index] for index in test_indices])
        metrics = classification_metrics(
            [cases[index].answerable for index in test_indices],
            test_scores,
            threshold,
        )
        results.append({"method": method, **metrics})
       
        method_details[method] = {
            "scores": test_scores.tolist(),
            "threshold": threshold,
            "accepted": (test_scores >= threshold).tolist(),
        }
        
        gates[method] = gate
        test_probabilities[method] = test_scores

    test_indices = indices_by_split["test"]
    llm_available = all(cases[index].llm_accept is not None for index in test_indices)
    
    if llm_available:
        labels = [cases[index].answerable for index in test_indices]
        llm_scores = np.asarray([float(bool(cases[index].llm_accept)) for index in test_indices])
        results.append({"method": "F_llm_evaluator", **classification_metrics(labels, llm_scores, 0.5)})
        
        method_details["F_llm_evaluator"] = {
            "scores": llm_scores.tolist(),
            "threshold": 0.5,
            "accepted": (llm_scores >= 0.5).tolist(),
        }
        
        e_result = next(result for result in results if result["method"] == "E_calibrated_gate")
        threshold = float(e_result["threshold"])
        e_scores = test_probabilities["E_calibrated_gate"]
        
        lower = max(0.0, threshold - uncertain_band)
        upper = min(1.0, threshold + uncertain_band)
        
        hybrid_scores = e_scores.copy()
        fallback_count = 0
        for position, case_index in enumerate(test_indices):
            if lower <= e_scores[position] <= upper:
                hybrid_scores[position] = float(bool(cases[case_index].llm_accept))
                fallback_count += 1
        
        hybrid_metrics = classification_metrics(labels, hybrid_scores, threshold)
        results.append(
            {
                "method": "G_gate_llm_fallback",
                **hybrid_metrics,
                "llm_fallback_count": fallback_count,
                "llm_fallback_rate": fallback_count / max(len(test_indices), 1),
            }
        )
        
        method_details["G_gate_llm_fallback"] = {
            "scores": hybrid_scores.tolist(),
            "threshold": threshold,
            "accepted": (hybrid_scores >= threshold).tolist(),
        }

    test_cases = [cases[index] for index in test_indices]
    test_retrieved = [retrieved[index] for index in test_indices]
    return {
        "cluster": {
            "chosen_k": clusters.chosen_k,
            "silhouette": clusters.silhouette,
            "sizes": np.bincount(clusters.labels, minlength=clusters.chosen_k).tolist(),
            "radii": clusters.radii.tolist(),
            "candidates": clusters.candidates,
        },
        "retrieval": retrieval_metrics(test_cases, test_retrieved, chunks),
        "methods": results,
        "method_details": method_details,
        "test_case_ids": [case.case_id for case in test_cases],
        "test_labels": [case.answerable for case in test_cases],
        "test_categories": [case.category for case in test_cases],
        "feature_extraction_ms_total": feature_ms,
        "feature_extraction_ms_per_query": feature_ms / max(len(cases), 1),
        "llm_methods_included": llm_available,
        "features": rows,
        "retrieved_chunk_ids": [[chunks[index].chunk_id for index in indices] for indices in retrieved],
        "gates": gates,
    }


def compact_results(report: dict[str, Any]) -> list[dict[str, Any]]:
    columns = (
        "method",
        "accuracy",
        "precision",
        "recall",
        "f1",
        "coverage",
        "false_accept_rate",
        "false_reject_rate",
        "brier",
        "llm_fallback_rate",
    )
    return [
        {
            key: round(value, 4) if isinstance(value, float) else value
            for key in columns
            if (value := row.get(key)) is not None
        }
        for row in report["methods"]
    ]


def plot_benchmark_report(
    report: dict[str, Any],
    *,
    output_dir: str | Path | None = None,
    show: bool = True,
) -> dict[str, Any]:
    """평가 요약과 test score 분포를 그리고, 선택적으로 PNG로 저장합니다."""
    import matplotlib.pyplot as plt

    methods = report["methods"]
    names = [row["method"] for row in methods]
    short_names = [name.split("_", 1)[0] for name in names]
    positions = np.arange(len(methods))

    summary, axes = plt.subplots(2, 2, figsize=(16, 10), constrained_layout=True)
    summary.suptitle("Retrieval Answerability Benchmark", fontsize=16, fontweight="bold")

    width = 0.24
    for offset, metric, color in (
        (-width, "precision", "#2563EB"),
        (0.0, "recall", "#16A34A"),
        (width, "f1", "#EA580C"),
    ):
        axes[0, 0].bar(
            positions + offset,
            [row[metric] for row in methods],
            width=width,
            label=metric,
            color=color,
            alpha=0.85,
        )
    axes[0, 0].set_title("Accept Decision Quality")
    axes[0, 0].set_xticks(positions, short_names)
    axes[0, 0].set_ylim(0.0, 1.05)
    axes[0, 0].set_ylabel("score")
    axes[0, 0].legend(frameon=False)
    axes[0, 0].grid(axis="y", alpha=0.2)

    coverages = [row["coverage"] for row in methods]
    false_accepts = [row["false_accept_rate"] for row in methods]
    scatter = axes[0, 1].scatter(
        coverages,
        false_accepts,
        c=[row["f1"] for row in methods],
        cmap="viridis",
        s=110,
        edgecolor="white",
        linewidth=0.8,
    )
    coordinate_labels: dict[tuple[float, float], list[str]] = {}
    for name, coverage, false_accept in zip(short_names, coverages, false_accepts, strict=True):
        coordinate_labels.setdefault((round(coverage, 6), round(false_accept, 6)), []).append(name)
    for (coverage, false_accept), labels_at_coordinate in coordinate_labels.items():
        axes[0, 1].annotate(
            ", ".join(labels_at_coordinate),
            (coverage, false_accept),
            xytext=(5, 5),
            textcoords="offset points",
        )
    axes[0, 1].axhline(0.10, color="#DC2626", linestyle="--", linewidth=1.2, label="FAR guardrail 0.10")
    axes[0, 1].set_title("Risk-Coverage Trade-off")
    axes[0, 1].set_xlabel("coverage (higher is better)")
    axes[0, 1].set_ylabel("false accept rate (lower is better)")
    axes[0, 1].set_xlim(-0.03, 1.03)
    axes[0, 1].set_ylim(-0.03, 1.03)
    axes[0, 1].legend(frameon=False)
    axes[0, 1].grid(alpha=0.2)
    summary.colorbar(scatter, ax=axes[0, 1], label="F1")

    axes[1, 0].bar(
        positions - width / 2,
        [row["false_accept_rate"] for row in methods],
        width=width,
        label="false accept",
        color="#DC2626",
        alpha=0.8,
    )
    axes[1, 0].bar(
        positions + width / 2,
        [row["false_reject_rate"] for row in methods],
        width=width,
        label="false reject",
        color="#7C3AED",
        alpha=0.8,
    )
    axes[1, 0].plot(
        positions,
        [row["brier"] for row in methods],
        color="#111827",
        marker="o",
        linewidth=1.5,
        label="Brier",
    )
    axes[1, 0].set_title("Error Rates and Calibration")
    axes[1, 0].set_xticks(positions, short_names)
    axes[1, 0].set_ylim(0.0, 1.05)
    axes[1, 0].legend(frameon=False, ncol=3)
    axes[1, 0].grid(axis="y", alpha=0.2)

    candidates = report["cluster"]["candidates"]
    if candidates:
        candidate_k = [row["k"] for row in candidates]
        silhouettes = [row["silhouette"] for row in candidates]
        axes[1, 1].plot(candidate_k, silhouettes, marker="o", color="#0891B2", linewidth=2)
        axes[1, 1].axvline(
            report["cluster"]["chosen_k"],
            color="#EA580C",
            linestyle="--",
            label=f"chosen K={report['cluster']['chosen_k']}",
        )
        axes[1, 1].legend(frameon=False)
        axes[1, 1].set_xticks(candidate_k)
    else:
        axes[1, 1].text(0.5, 0.5, "K=1 fallback\n(no valid candidates)", ha="center", va="center")
    axes[1, 1].set_title("Cluster Selection")
    axes[1, 1].set_xlabel("K")
    axes[1, 1].set_ylabel("cosine silhouette")
    axes[1, 1].grid(alpha=0.2)

    details = report["method_details"]
    labels = np.asarray(report["test_labels"], dtype=bool)
    score_figure, score_axis = plt.subplots(figsize=(16, 6), constrained_layout=True)
    score_figure.suptitle("Test Score Separation and Validation Thresholds", fontsize=15, fontweight="bold")
    box_width = 0.28
    legend_handles = None
    for index, name in enumerate(names):
        scores = np.asarray(details[name]["scores"], dtype=float)
        negative_scores = scores[~labels]
        positive_scores = scores[labels]
        boxes = score_axis.boxplot(
            [negative_scores, positive_scores],
            positions=[index - 0.18, index + 0.18],
            widths=box_width,
            patch_artist=True,
            manage_ticks=False,
            medianprops={"color": "#111827"},
        )
        boxes["boxes"][0].set_facecolor("#FCA5A5")
        boxes["boxes"][1].set_facecolor("#86EFAC")
        score_axis.scatter(
            index,
            details[name]["threshold"],
            marker="D",
            s=55,
            color="#1D4ED8",
            zorder=4,
        )
        if legend_handles is None:
            legend_handles = [boxes["boxes"][0], boxes["boxes"][1]]
    score_axis.set_xticks(positions, short_names)
    score_axis.set_ylim(-0.03, 1.03)
    score_axis.set_ylabel("acceptance probability / score")
    score_axis.grid(axis="y", alpha=0.2)
    threshold_handle = score_axis.scatter([], [], marker="D", s=55, color="#1D4ED8")
    score_axis.legend(
        [*legend_handles, threshold_handle],
        ["unanswerable", "answerable", "threshold"],
        frameon=False,
        ncol=3,
        loc="upper center",
        bbox_to_anchor=(0.5, -0.10),
    )

    saved_paths: dict[str, str] = {}
    if output_dir is not None:
        destination = Path(output_dir)
        destination.mkdir(parents=True, exist_ok=True)
        summary_path = destination / "benchmark_summary.png"
        scores_path = destination / "score_distributions.png"
        summary.savefig(summary_path, dpi=160, bbox_inches="tight")
        score_figure.savefig(scores_path, dpi=160, bbox_inches="tight")
        saved_paths = {"summary": str(summary_path.resolve()), "scores": str(scores_path.resolve())}
    if show and "agg" not in plt.get_backend().lower():
        plt.show()
    return {"summary": summary, "scores": score_figure, "saved_paths": saved_paths}
