from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from contracts import (
    Provider,
    RaptorBuildContext,
    RaptorBuildOptions,
    RaptorBuildRequest,
    RaptorSourceChunkInput,
)
from retrieval import CompositeRaptorBuildService, GeminiRaptorBuildService, OpenAIRaptorBuildService
from retrieval.openai_service import _OpenAIEmbedder


def _request(provider: Provider) -> RaptorBuildRequest:
    return RaptorBuildRequest(
        context=RaptorBuildContext(
            run_id=uuid4(),
            workspace_id=uuid4(),
            project_id=uuid4(),
            snapshot_id=uuid4(),
        ),
        provider=provider,
        embedding_model="embedding-test",
        summary_model="summary-test",
        chunks=[
            RaptorSourceChunkInput(chunk_id=uuid4(), document_id=uuid4(), text="첫 번째 근거"),
            RaptorSourceChunkInput(chunk_id=uuid4(), document_id=uuid4(), text="두 번째 근거"),
        ],
        options=RaptorBuildOptions(target_cluster_size=2, max_summary_levels=1),
    )


class FakeGeminiModels:
    def __init__(self) -> None:
        self.embed_calls = 0
        self.summary_calls = 0

    async def embed_content(self, **kwargs: object) -> object:
        contents = kwargs["contents"]
        assert isinstance(contents, list)
        assert kwargs["config"] == {"task_type": "RETRIEVAL_DOCUMENT", "output_dimensionality": 1536}
        self.embed_calls += 1
        values = [[1.0, 0.0], [0.0, 1.0]] if len(contents) == 2 else [[0.7, 0.7]]
        return SimpleNamespace(embeddings=[SimpleNamespace(values=value) for value in values])

    async def generate_content(self, **kwargs: object) -> object:
        del kwargs
        self.summary_calls += 1
        return SimpleNamespace(text="두 근거의 제한된 요약")


class FakeOpenAIEmbeddings:
    async def create(self, **kwargs: object) -> object:
        assert kwargs["dimensions"] == 1536
        return SimpleNamespace(data=[SimpleNamespace(index=0, embedding=[1.0, 0.0])])


@pytest.mark.asyncio
async def test_gemini_raptor_build_preserves_leaf_provenance() -> None:
    models = FakeGeminiModels()
    request = _request(Provider.GEMINI)
    service = CompositeRaptorBuildService(
        OpenAIRaptorBuildService(SimpleNamespace()),
        GeminiRaptorBuildService(SimpleNamespace(models=models)),
    )

    response = await service.build(request)

    leaves = [node for node in response.nodes if node.kind == "LEAF"]
    summaries = [node for node in response.nodes if node.kind == "SUMMARY"]
    assert len(leaves) == 2
    assert len(summaries) == 1
    assert {node.source_chunk_id for node in leaves} == {chunk.chunk_id for chunk in request.chunks}
    assert models.embed_calls == 2
    assert models.summary_calls == 1


@pytest.mark.asyncio
async def test_openai_v3_embedding_uses_storage_dimension() -> None:
    embedder = _OpenAIEmbedder(SimpleNamespace(embeddings=FakeOpenAIEmbeddings()), "text-embedding-3-large")

    assert await embedder.embed(["근거"]) == [[1.0, 0.0]]
