package com.freelanceops.backend.domain.knowledge.client.dto.request;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public record RaptorBuildRequest(RaptorBuildContext context, String provider, String embeddingModel, String summaryModel, List<RaptorSourceChunk> chunks, RaptorBuildOptions options) {
    public record RaptorBuildContext(UUID runId, UUID workspaceId, UUID projectId, UUID snapshotId) {
    }
    public record RaptorSourceChunk(UUID chunkId, UUID documentId, String text, Map<String, String> metadata) {
    }
    public record RaptorBuildOptions(int targetClusterSize, int maxSummaryLevels, int kmeansIterations) {
    }
}
