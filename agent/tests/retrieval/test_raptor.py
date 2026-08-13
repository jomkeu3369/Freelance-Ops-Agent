from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID, uuid4

import pytest

from retrieval import (
    CosineKMeansClusterer,
    RaptorBuildConfig,
    RaptorNodeKind,
    RaptorRetriever,
    RaptorTreeBuilder,
    SourceChunk,
)


class KeywordEmbeddingProvider:
    async def embed(self, texts: Sequence[str]) -> Sequence[Sequence[float]]:
        return [self._vector(text) for text in texts]

    @staticmethod
    def _vector(text: str) -> list[float]:
        lowered = text.lower()
        return [
            1.0 + lowered.count("결제"),
            1.0 + lowered.count("보안"),
            1.0 + lowered.count("검색"),
        ]


class RecordingSummaryProvider:
    def __init__(self) -> None:
        self.calls: list[tuple[str, ...]] = []

    async def summarize(self, texts: Sequence[str]) -> str:
        self.calls.append(tuple(texts))
        return " | ".join(texts)


def make_chunks() -> list[SourceChunk]:
    document_id = uuid4()
    return [
        SourceChunk(uuid4(), document_id, "카드 결제와 환불 정책", {"page": "1"}),
        SourceChunk(uuid4(), document_id, "정기 결제 실패 재시도", {"page": "2"}),
        SourceChunk(uuid4(), document_id, "RBAC 보안과 감사 로그", {"page": "3"}),
        SourceChunk(uuid4(), document_id, "개인정보 보안 정책", {"page": "4"}),
        SourceChunk(uuid4(), document_id, "벡터 검색 품질 평가", {"page": "5"}),
        SourceChunk(uuid4(), document_id, "키워드 검색과 RRF", {"page": "6"}),
    ]


@pytest.mark.asyncio
async def test_builds_recursive_tree_with_source_provenance() -> None:
    chunks = make_chunks()
    summarizer = RecordingSummaryProvider()
    snapshot_id = uuid4()
    builder = RaptorTreeBuilder(
        KeywordEmbeddingProvider(),
        summarizer,
        config=RaptorBuildConfig(target_cluster_size=2, max_summary_levels=4),
    )

    index = await builder.build(
        workspace_id=uuid4(),
        snapshot_id=snapshot_id,
        chunks=chunks,
        embedding_model="test-embedding-v1",
        summary_model="test-summary-v1",
    )

    leaves = [node for node in index.nodes if node.kind is RaptorNodeKind.LEAF]
    summaries = [node for node in index.nodes if node.kind is RaptorNodeKind.SUMMARY]
    assert len(leaves) == len(chunks)
    assert {node.source_chunk_id for node in leaves} == {chunk.chunk_id for chunk in chunks}
    assert len(index.root_ids) == 1
    assert max(node.level for node in summaries) >= 2
    assert summarizer.calls
    assert all(node.snapshot_id == snapshot_id for node in index.nodes)


@pytest.mark.asyncio
async def test_retrieval_uses_tree_but_returns_only_original_chunks_as_evidence() -> None:
    chunks = make_chunks()
    embedder = KeywordEmbeddingProvider()
    index = await RaptorTreeBuilder(
        embedder,
        RecordingSummaryProvider(),
        config=RaptorBuildConfig(target_cluster_size=2),
    ).build(
        workspace_id=uuid4(),
        snapshot_id=uuid4(),
        chunks=chunks,
        embedding_model="test-embedding-v1",
        summary_model="test-summary-v1",
    )

    result = await RaptorRetriever(embedder).retrieve(index, "결제 정책", tree_top_k=3, evidence_top_k=2)

    assert result.selected_nodes
    assert len(result.evidence) == 2
    assert all(hit.source_chunk_id in {chunk.chunk_id for chunk in chunks} for hit in result.evidence)
    assert "결제" in result.evidence[0].text
    assert result.evidence[0].score >= result.evidence[1].score


def test_cosine_clusterer_is_deterministic_and_partitions_every_node() -> None:
    embeddings = (
        (1.0, 0.0),
        (0.9, 0.1),
        (0.0, 1.0),
        (0.1, 0.9),
        (0.7, 0.7),
    )
    clusterer = CosineKMeansClusterer(target_cluster_size=2, iterations=10)

    first = clusterer.cluster(embeddings)
    second = clusterer.cluster(embeddings)

    assert first == second
    assert sorted(index for cluster in first for index in cluster) == list(range(len(embeddings)))
    assert len(first) < len(embeddings)


@pytest.mark.asyncio
async def test_rejects_duplicate_source_ids_and_bad_embedding_dimensions() -> None:
    chunk_id = uuid4()
    duplicate_chunks = [
        SourceChunk(chunk_id, uuid4(), "첫 청크"),
        SourceChunk(chunk_id, uuid4(), "중복 청크"),
    ]
    builder = RaptorTreeBuilder(KeywordEmbeddingProvider(), RecordingSummaryProvider())

    with pytest.raises(ValueError, match="unique"):
        await builder.build(
            workspace_id=uuid4(),
            snapshot_id=uuid4(),
            chunks=duplicate_chunks,
            embedding_model="embedding",
            summary_model="summary",
        )

    class BrokenEmbeddingProvider:
        async def embed(self, texts: Sequence[str]) -> Sequence[Sequence[float]]:
            return [[1.0], [1.0, 2.0]][: len(texts)]

    broken = RaptorTreeBuilder(BrokenEmbeddingProvider(), RecordingSummaryProvider())
    with pytest.raises(ValueError, match="dimension"):
        await broken.build(
            workspace_id=uuid4(),
            snapshot_id=uuid4(),
            chunks=[SourceChunk(uuid4(), uuid4(), "a"), SourceChunk(uuid4(), uuid4(), "b")],
            embedding_model="embedding",
            summary_model="summary",
        )


def test_source_chunk_rejects_empty_text() -> None:
    with pytest.raises(ValueError, match="must not be empty"):
        SourceChunk(UUID(int=1), UUID(int=2), "  ")
