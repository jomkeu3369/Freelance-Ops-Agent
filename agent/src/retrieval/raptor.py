"""Storage-neutral RAPTOR tree construction and retrieval.

The Agent owns recursive clustering and summarisation. Persistence, workspace
authorization and the operational pgvector index remain Spring responsibilities.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from math import ceil
from typing import Protocol
from uuid import UUID, uuid5

import numpy as np
from numpy.typing import NDArray

Embedding = tuple[float, ...]
FloatArray = NDArray[np.float64]


class EmbeddingProvider(Protocol):
    """Embed texts using the model recorded on the index snapshot."""

    async def embed(self, texts: Sequence[str]) -> Sequence[Sequence[float]]: ...


class SummaryProvider(Protocol):
    """Summarise one cluster without changing source authority."""

    async def summarize(self, texts: Sequence[str]) -> str: ...


class NodeClusterer(Protocol):
    """Partition one tree level into non-empty clusters."""

    def cluster(self, embeddings: Sequence[Embedding]) -> tuple[tuple[int, ...], ...]: ...


class RaptorNodeKind(StrEnum):
    LEAF = "LEAF"
    SUMMARY = "SUMMARY"


@dataclass(frozen=True, slots=True)
class SourceChunk:
    """A Spring-owned source chunk supplied to the RAPTOR builder."""

    chunk_id: UUID
    document_id: UUID
    text: str
    metadata: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.text.strip():
            raise ValueError("source chunk text must not be empty")


@dataclass(frozen=True, slots=True)
class RaptorNode:
    node_id: UUID
    workspace_id: UUID
    snapshot_id: UUID
    kind: RaptorNodeKind
    level: int
    text: str
    embedding: Embedding
    child_ids: tuple[UUID, ...] = ()
    source_chunk_id: UUID | None = None
    document_id: UUID | None = None
    metadata: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.level < 0:
            raise ValueError("node level must not be negative")
        if not self.text.strip():
            raise ValueError("node text must not be empty")
        if not self.embedding:
            raise ValueError("node embedding must not be empty")
        if self.kind is RaptorNodeKind.LEAF:
            if self.level != 0 or self.source_chunk_id is None or self.document_id is None or self.child_ids:
                raise ValueError("leaf nodes require source ids, level 0 and no children")
        elif self.source_chunk_id is not None or self.document_id is not None or not self.child_ids:
            raise ValueError("summary nodes require children and must not impersonate source chunks")


@dataclass(frozen=True, slots=True)
class RaptorIndex:
    workspace_id: UUID
    snapshot_id: UUID
    embedding_model: str
    summary_model: str
    nodes: tuple[RaptorNode, ...]
    root_ids: tuple[UUID, ...]

    def __post_init__(self) -> None:
        if not self.embedding_model.strip() or not self.summary_model.strip():
            raise ValueError("index model versions must not be empty")
        if not self.nodes or not self.root_ids:
            raise ValueError("RAPTOR index must contain nodes and roots")
        node_ids = {node.node_id for node in self.nodes}
        if len(node_ids) != len(self.nodes):
            raise ValueError("RAPTOR node ids must be unique")
        if not set(self.root_ids).issubset(node_ids):
            raise ValueError("all roots must reference index nodes")

    def nodes_by_id(self) -> dict[UUID, RaptorNode]:
        return {node.node_id: node for node in self.nodes}


@dataclass(frozen=True, slots=True)
class RaptorBuildConfig:
    target_cluster_size: int = 4
    max_summary_levels: int = 4
    kmeans_iterations: int = 20

    def __post_init__(self) -> None:
        if self.target_cluster_size < 2:
            raise ValueError("target_cluster_size must be at least 2")
        if self.max_summary_levels < 1:
            raise ValueError("max_summary_levels must be at least 1")
        if self.kmeans_iterations < 1:
            raise ValueError("kmeans_iterations must be at least 1")


class CosineKMeansClusterer:
    """Small deterministic spherical K-means baseline.

    The cluster count is derived from a bounded target size. It is deliberately
    deterministic and replaceable so GMM/BIC can be benchmarked later without
    changing the tree or persistence contracts.
    """

    def __init__(self, *, target_cluster_size: int = 4, iterations: int = 20) -> None:
        if target_cluster_size < 2 or iterations < 1:
            raise ValueError("invalid clustering configuration")
        self._target_cluster_size = target_cluster_size
        self._iterations = iterations

    def cluster(self, embeddings: Sequence[Embedding]) -> tuple[tuple[int, ...], ...]:
        matrix = _normalised_matrix(embeddings)
        count = matrix.shape[0]
        if count == 0:
            raise ValueError("cannot cluster an empty tree level")
        if count <= self._target_cluster_size:
            return (tuple(range(count)),)

        cluster_count = min(count - 1, ceil(count / self._target_cluster_size))
        centroids = self._initial_centroids(matrix, cluster_count)
        assignments = np.zeros(count, dtype=np.int64)

        for _ in range(self._iterations):
            next_assignments = np.argmax(matrix @ centroids.T, axis=1)
            if np.array_equal(assignments, next_assignments):
                assignments = next_assignments
                break
            assignments = next_assignments
            centroids = self._updated_centroids(matrix, assignments, centroids)

        groups = tuple(
            tuple(int(index) for index in np.flatnonzero(assignments == cluster_id))
            for cluster_id in range(cluster_count)
        )
        non_empty = tuple(group for group in groups if group)
        if len(non_empty) >= count:
            raise RuntimeError("clusterer did not reduce the tree level")
        return non_empty

    @staticmethod
    def _initial_centroids(matrix: FloatArray, cluster_count: int) -> FloatArray:
        selected = [0]
        while len(selected) < cluster_count:
            similarities = matrix @ matrix[selected].T
            nearest = np.max(similarities, axis=1)
            nearest[selected] = 1.0
            selected.append(int(np.argmin(nearest)))
        return matrix[selected].copy()

    @staticmethod
    def _updated_centroids(
        matrix: FloatArray,
        assignments: NDArray[np.int64],
        previous: FloatArray,
    ) -> FloatArray:
        updated = previous.copy()
        for cluster_id in range(previous.shape[0]):
            members = matrix[assignments == cluster_id]
            if members.size:
                centroid = np.mean(members, axis=0)
                norm = float(np.linalg.norm(centroid))
                if norm > 0:
                    updated[cluster_id] = centroid / norm
        return updated


class RaptorTreeBuilder:
    """Build an immutable recursive abstraction tree from source chunks."""

    def __init__(
        self,
        embedder: EmbeddingProvider,
        summarizer: SummaryProvider,
        *,
        config: RaptorBuildConfig | None = None,
        clusterer: NodeClusterer | None = None,
    ) -> None:
        self._embedder = embedder
        self._summarizer = summarizer
        self._config = config or RaptorBuildConfig()
        self._clusterer = clusterer or CosineKMeansClusterer(
            target_cluster_size=self._config.target_cluster_size,
            iterations=self._config.kmeans_iterations,
        )

    async def build(
        self,
        *,
        workspace_id: UUID,
        snapshot_id: UUID,
        chunks: Sequence[SourceChunk],
        embedding_model: str,
        summary_model: str,
    ) -> RaptorIndex:
        if not chunks:
            raise ValueError("at least one source chunk is required")
        if len({chunk.chunk_id for chunk in chunks}) != len(chunks):
            raise ValueError("source chunk ids must be unique")

        leaf_embeddings = await self._embed_texts([chunk.text for chunk in chunks])
        leaves = [
            RaptorNode(
                node_id=uuid5(snapshot_id, f"leaf:{chunk.chunk_id}"),
                workspace_id=workspace_id,
                snapshot_id=snapshot_id,
                kind=RaptorNodeKind.LEAF,
                level=0,
                text=chunk.text,
                embedding=embedding,
                source_chunk_id=chunk.chunk_id,
                document_id=chunk.document_id,
                metadata=dict(chunk.metadata),
            )
            for chunk, embedding in zip(chunks, leaf_embeddings, strict=True)
        ]

        all_nodes = list(leaves)
        current = leaves
        level = 1
        while len(current) > 1:
            clusters: Sequence[Sequence[int]]
            if level >= self._config.max_summary_levels:
                clusters = (tuple(range(len(current))),)
            else:
                clusters = self._clusterer.cluster([node.embedding for node in current])
            parents = await self._summarise_level(
                workspace_id=workspace_id,
                snapshot_id=snapshot_id,
                level=level,
                nodes=current,
                clusters=clusters,
            )
            if len(parents) >= len(current):
                raise RuntimeError("RAPTOR clustering must reduce each tree level")
            all_nodes.extend(parents)
            current = parents
            level += 1

        return RaptorIndex(
            workspace_id=workspace_id,
            snapshot_id=snapshot_id,
            embedding_model=embedding_model,
            summary_model=summary_model,
            nodes=tuple(all_nodes),
            root_ids=tuple(node.node_id for node in current),
        )

    async def _summarise_level(
        self,
        *,
        workspace_id: UUID,
        snapshot_id: UUID,
        level: int,
        nodes: Sequence[RaptorNode],
        clusters: Sequence[Sequence[int]],
    ) -> list[RaptorNode]:
        child_groups = [tuple(nodes[index] for index in cluster) for cluster in clusters]
        if not child_groups or any(not group for group in child_groups):
            raise RuntimeError("clusterer returned an empty partition")
        covered = [node.node_id for group in child_groups for node in group]
        if len(covered) != len(nodes) or len(set(covered)) != len(nodes):
            raise RuntimeError("clusterer must partition every node exactly once")

        summaries = [await self._summarizer.summarize([node.text for node in group]) for group in child_groups]
        if any(not summary.strip() for summary in summaries):
            raise ValueError("summary provider returned empty text")
        embeddings = await self._embed_texts(summaries)

        return [
            RaptorNode(
                node_id=uuid5(snapshot_id, f"summary:{level}:{','.join(str(node.node_id) for node in group)}"),
                workspace_id=workspace_id,
                snapshot_id=snapshot_id,
                kind=RaptorNodeKind.SUMMARY,
                level=level,
                text=summary,
                embedding=embedding,
                child_ids=tuple(node.node_id for node in group),
            )
            for group, summary, embedding in zip(child_groups, summaries, embeddings, strict=True)
        ]

    async def _embed_texts(self, texts: Sequence[str]) -> tuple[Embedding, ...]:
        raw = await self._embedder.embed(texts)
        if len(raw) != len(texts):
            raise ValueError("embedding provider returned the wrong number of vectors")
        embeddings = tuple(tuple(float(value) for value in vector) for vector in raw)
        _normalised_matrix(embeddings)
        return embeddings


@dataclass(frozen=True, slots=True)
class RaptorEvidenceHit:
    source_chunk_id: UUID
    document_id: UUID
    text: str
    score: float
    metadata: Mapping[str, str]


@dataclass(frozen=True, slots=True)
class RaptorRetrieval:
    selected_nodes: tuple[RaptorNode, ...]
    evidence: tuple[RaptorEvidenceHit, ...]


class RaptorRetriever:
    """Retrieve across tree levels and resolve every result back to source leaves."""

    def __init__(self, embedder: EmbeddingProvider) -> None:
        self._embedder = embedder

    async def retrieve(
        self,
        index: RaptorIndex,
        query: str,
        *,
        tree_top_k: int = 5,
        evidence_top_k: int = 5,
    ) -> RaptorRetrieval:
        if not query.strip():
            raise ValueError("query must not be empty")
        if tree_top_k < 1 or evidence_top_k < 1:
            raise ValueError("retrieval limits must be positive")

        raw_query = await self._embedder.embed([query])
        if len(raw_query) != 1:
            raise ValueError("embedding provider must return one query vector")
        query_vector = _normalised_matrix([tuple(float(value) for value in raw_query[0])])[0]
        node_matrix = _normalised_matrix([node.embedding for node in index.nodes])
        if query_vector.shape[0] != node_matrix.shape[1]:
            raise ValueError("query and index embedding dimensions differ")

        scores = node_matrix @ query_vector
        selected_indices = np.argsort(-scores, kind="stable")[: min(tree_top_k, len(index.nodes))]
        selected = tuple(index.nodes[int(index_value)] for index_value in selected_indices)

        nodes_by_id = index.nodes_by_id()
        leaf_ids: set[UUID] = set()
        for node in selected:
            self._collect_leaf_ids(node, nodes_by_id, leaf_ids)
        leaves = [nodes_by_id[node_id] for node_id in leaf_ids]
        leaf_matrix = _normalised_matrix([leaf.embedding for leaf in leaves])
        leaf_scores = leaf_matrix @ query_vector
        ranked_leaf_indices = np.argsort(-leaf_scores, kind="stable")[: min(evidence_top_k, len(leaves))]

        evidence = tuple(
            RaptorEvidenceHit(
                source_chunk_id=_required_uuid(leaf.source_chunk_id),
                document_id=_required_uuid(leaf.document_id),
                text=leaf.text,
                score=float(leaf_scores[int(index_value)]),
                metadata=dict(leaf.metadata),
            )
            for index_value in ranked_leaf_indices
            for leaf in (leaves[int(index_value)],)
        )
        return RaptorRetrieval(selected_nodes=selected, evidence=evidence)

    @classmethod
    def _collect_leaf_ids(
        cls,
        node: RaptorNode,
        nodes_by_id: Mapping[UUID, RaptorNode],
        output: set[UUID],
    ) -> None:
        if node.kind is RaptorNodeKind.LEAF:
            output.add(node.node_id)
            return
        for child_id in node.child_ids:
            try:
                child = nodes_by_id[child_id]
            except KeyError as error:
                raise ValueError(f"RAPTOR child node is missing: {child_id}") from error
            cls._collect_leaf_ids(child, nodes_by_id, output)


def _normalised_matrix(embeddings: Sequence[Embedding]) -> FloatArray:
    if not embeddings:
        raise ValueError("embeddings must not be empty")
    dimensions = {len(embedding) for embedding in embeddings}
    if len(dimensions) != 1 or 0 in dimensions:
        raise ValueError("embeddings must have one non-zero dimension")
    matrix = np.asarray(embeddings, dtype=np.float64)
    if not np.isfinite(matrix).all():
        raise ValueError("embeddings must contain finite values")
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    if np.any(norms == 0):
        raise ValueError("zero vectors cannot be used for cosine retrieval")
    return matrix / norms


def _required_uuid(value: UUID | None) -> UUID:
    if value is None:
        raise RuntimeError("leaf source id invariant was violated")
    return value
