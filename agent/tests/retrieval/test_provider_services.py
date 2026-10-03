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
from retrieval import OpenAIRaptorBuildService
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


class FakeOpenAIEmbeddings:
    async def create(self, **kwargs: object) -> object:
        assert kwargs["dimensions"] == 1536
        return SimpleNamespace(data=[SimpleNamespace(index=0, embedding=[1.0, 0.0])])


@pytest.mark.asyncio
async def test_retired_raptor_provider_is_rejected_without_creating_client() -> None:
    service = OpenAIRaptorBuildService()
    with pytest.raises(ValueError, match="does not select OpenAI"):
        await service.build(_request(Provider.GEMINI))
    assert service._client is None


@pytest.mark.asyncio
async def test_openai_v3_embedding_uses_storage_dimension() -> None:
    embedder = _OpenAIEmbedder(SimpleNamespace(embeddings=FakeOpenAIEmbeddings()), "text-embedding-3-large")

    assert await embedder.embed(["근거"]) == [[1.0, 0.0]]
