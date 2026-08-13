package com.freelanceops.backend.domain.knowledge.dto.response;

import java.util.UUID;

public record DocumentChunkResponse(UUID id, int chunkIndex, String content, String embeddingModel, Integer startOffset, Integer endOffset) {
}
