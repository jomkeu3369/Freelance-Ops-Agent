from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from contracts import Provider, RaptorBuildContext, RaptorBuildOptions, RaptorBuildRequest, RaptorSourceChunkInput
from retrieval import OpenAIRaptorBuildService
from retrieval.provider_services import _OpenAIEmbedder


def _request(provider: Provider) -> RaptorBuildRequest:
    return RaptorBuildRequest(
        context=RaptorBuildContext(run_id=uuid4(), workspace_id=uuid4(), project_id=uuid4(), snapshot_id=uuid4()),
        provider=provider,
        embedding_model="embedding-test",
        summary_model="summary-test",
        chunks=[
            RaptorSourceChunkInput(chunk_id=uuid4(), document_id=uuid4(), text="첫 번째 근거"),
            RaptorSourceChunkInput(chunk_id=uuid4(), document_id=uuid4(), text="두 번째 근거"),
        ],
        options=RaptorBuildOptions(target_cluster_size=2, max_summary_levels=1)
    )


class FakeOpenAIEmbeddings:
    def __init__(self) -> None:
        self.calls = 0

    async def create(self, **kwargs: object) -> object:
        contents = kwargs["input"]
        assert isinstance(contents, list)
        if str(kwargs["model"]).startswith("text-embedding-3-"):
            assert kwargs["dimensions"] == 1536
        self.calls += 1
        values = [[1.0, 0.0], [0.0, 1.0]] if len(contents) == 2 else [[0.7, 0.7]]
        return SimpleNamespace(
            data=[SimpleNamespace(index=index, embedding=value) for index, value in enumerate(values)]
        )


@pytest.mark.asyncio
async def test_openai_raptor_build_preserves_leaf_provenance() -> None:
    embeddings = FakeOpenAIEmbeddings()
    summary_call = AsyncMock(return_value=SimpleNamespace(output_text="두 근거의 제한된 요약"))
    request = _request(Provider.OPENAI)
    service = OpenAIRaptorBuildService(
        SimpleNamespace(embeddings=embeddings, responses=SimpleNamespace(create=summary_call))
    )

    response = await service.build(request)

    leaves = [node for node in response.nodes if node.kind == "LEAF"]
    summaries = [node for node in response.nodes if node.kind == "SUMMARY"]
    assert len(leaves) == 2
    assert len(summaries) == 1
    assert {node.source_chunk_id for node in leaves} == {chunk.chunk_id for chunk in request.chunks}
    assert embeddings.calls == 2
    summary_call.assert_awaited_once()


@pytest.mark.asyncio
async def test_retired_raptor_provider_rejected_without_client_io() -> None:
    client = AsyncMock()
    with pytest.raises(ValueError, match="does not select OpenAI"):
        await OpenAIRaptorBuildService(client).build(_request(Provider.GEMINI))
    assert client.mock_calls == []


@pytest.mark.asyncio
async def test_openai_v3_embedding_uses_storage_dimension() -> None:
    embedder = _OpenAIEmbedder(SimpleNamespace(embeddings=FakeOpenAIEmbeddings()), "text-embedding-3-large")

    assert await embedder.embed(["근거"]) == [[0.7, 0.7]]
