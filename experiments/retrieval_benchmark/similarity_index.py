from __future__ import annotations

import math
from collections import Counter
from collections.abc import Sequence

import numpy as np

if __package__:
    from .embeddings import normalize_rows
    from .similarity_types import Chunk, ClusterResult
    from .text_chunks import tokenize
else:
    from embeddings import normalize_rows
    from similarity_types import Chunk, ClusterResult
    from text_chunks import tokenize


def _spherical_kmeans_once(vectors: np.ndarray, k: int, *, seed: int, max_iter: int = 100) -> tuple[np.ndarray, np.ndarray, float]:  # noqa: E501
    rng = np.random.default_rng(seed)
    first = int(rng.integers(len(vectors)))
    centers = [vectors[first]]
    while len(centers) < k:
        similarities = vectors @ np.asarray(centers).T
        distances = np.maximum(0.0, 1.0 - similarities.max(axis=1))
        total = float(distances.sum())
        index = (
            int(rng.integers(len(vectors)))
            if total == 0
            else int(rng.choice(len(vectors), p=distances / total))
        )
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


def spherical_kmeans(vectors: np.ndarray, k: int, *, seed: int = 42, n_init: int = 8) -> tuple[np.ndarray, np.ndarray]:
    attempts = [
        _spherical_kmeans_once(vectors, k, seed=seed + attempt) for attempt in range(n_init)
    ]
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
        b = min(
            float(distances[index, labels == other].mean()) for other in unique if other != label
        )
        values.append((b - a) / max(a, b, 1e-12))
    return float(np.mean(values))


def select_clusters(vectors: np.ndarray, *, max_k: int = 12, min_cluster_size: int = 2, min_silhouette: float = 0.05, seed: int = 42) -> ClusterResult:  # noqa: E501
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
        radii[cluster_id] = (
            float(np.quantile(member_distances, 0.9)) if len(member_distances) else 0.0
        )
    return ClusterResult(
        labels=labels,
        centroids=centroids,
        radii=radii,
        chosen_k=len(centroids),
        silhouette=float(silhouette),
        candidates=candidates
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


def _deduplicated_top_indices(semantic_scores: np.ndarray, chunks: Sequence[Chunk], *, k: int, adjacent_window: int = 1) -> list[int]:  # noqa: E501
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


def extract_features(query: str, query_vector: np.ndarray, chunks: Sequence[Chunk], corpus_vectors: np.ndarray, clusters: ClusterResult, bm25: BM25Index, *, top_k: int = 3) -> tuple[dict[str, float], list[int]]:  # noqa: E501
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
        "distinct_documents": float(len({chunks[index].document_id for index in selected}))
        / max(len(selected), 1),
    }
    return row, selected
