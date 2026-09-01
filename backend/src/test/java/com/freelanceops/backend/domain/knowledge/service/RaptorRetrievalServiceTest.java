package com.freelanceops.backend.domain.knowledge.service;

import com.freelanceops.backend.domain.knowledge.entity.*;
import com.freelanceops.backend.domain.knowledge.model.RaptorNodeKind;
import com.freelanceops.backend.domain.knowledge.repository.*;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class RaptorRetrievalServiceTest {
    @Test
    void selectedSummaryResolvesBackToOriginalLeafChunks() {
        RaptorActiveSnapshotRepository activeRepository = mock(RaptorActiveSnapshotRepository.class);
        RaptorNodeRepository nodeRepository = mock(RaptorNodeRepository.class);
        RaptorNodeSearchRepository searchRepository = mock(RaptorNodeSearchRepository.class);
        DocumentChunkRepository chunkRepository = mock(DocumentChunkRepository.class);
        UUID workspaceId = UUID.randomUUID(); UUID snapshotId = UUID.randomUUID(); UUID documentId = UUID.randomUUID();
        UUID firstChunkId = UUID.randomUUID(); UUID secondChunkId = UUID.randomUUID();
        RaptorNodeEntity first = node(UUID.randomUUID(), workspaceId, snapshotId, firstChunkId, documentId, vector(1));
        RaptorNodeEntity second = node(UUID.randomUUID(), workspaceId, snapshotId, secondChunkId, documentId, vector(0.2f));
        RaptorNodeEntity summary = new RaptorNodeEntity(UUID.randomUUID(), workspaceId, snapshotId, RaptorNodeKind.SUMMARY, 1, "summary", vector(0.9f), new UUID[]{first.id(), second.id()}, null, null, Map.of(), Instant.now());
        DocumentChunkEntity firstChunk = new DocumentChunkEntity(firstChunkId, workspaceId, documentId, 0, "first", vector(1), "embedding", null, null, Instant.now());
        DocumentChunkEntity secondChunk = new DocumentChunkEntity(secondChunkId, workspaceId, documentId, 1, "second", vector(0.2f), "embedding", null, null, Instant.now());

        when(activeRepository.findById(workspaceId)).thenReturn(Optional.of(new RaptorActiveSnapshotEntity(workspaceId, snapshotId, Instant.now())));
        when(nodeRepository.findAllByWorkspaceIdAndSnapshotId(workspaceId, snapshotId)).thenReturn(List.of(first, second, summary));
        when(searchRepository.nearest(eq(workspaceId), eq(snapshotId), any(float[].class), eq(1))).thenReturn(List.of(summary));
        when(chunkRepository.findAllById(any())).thenReturn(List.of(firstChunk, secondChunk));

        RaptorRetrievalService service = new RaptorRetrievalService(activeRepository, nodeRepository, searchRepository, chunkRepository);
        assertThat(service.retrieve(workspaceId, vector(1), 1, 2)).extracting(DocumentChunkEntity::id).containsExactly(firstChunkId, secondChunkId);
    }

    private static RaptorNodeEntity node(UUID id, UUID workspaceId, UUID snapshotId, UUID chunkId, UUID documentId, float[] embedding) {
        return new RaptorNodeEntity(id, workspaceId, snapshotId, RaptorNodeKind.LEAF, 0, "leaf", embedding, new UUID[0], chunkId, documentId, Map.of(), Instant.now());
    }

    private static float[] vector(float first) { float[] values = new float[1536]; values[0] = first; values[1] = 1; return values; }
}
