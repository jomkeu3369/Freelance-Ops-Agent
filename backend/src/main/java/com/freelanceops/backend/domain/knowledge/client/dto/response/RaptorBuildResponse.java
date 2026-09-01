package com.freelanceops.backend.domain.knowledge.client.dto.response;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public record RaptorBuildResponse(UUID workspaceId, UUID snapshotId, String embeddingModel, String summaryModel, List<RaptorNode> nodes, List<UUID> rootIds) {
    public record RaptorNode(UUID nodeId, String kind, int level, String text, List<Float> embedding, List<UUID> childIds, UUID sourceChunkId, UUID documentId, Map<String, String> metadata) {
    }
}
