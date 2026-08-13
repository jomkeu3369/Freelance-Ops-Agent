package com.freelanceops.backend.domain.knowledge.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

public record DocumentChunkRequest(
    @NotBlank @Size(max = 20000) String content,
    @Size(min = 1536, max = 1536) List<Float> embedding,
    @Size(max = 120) String embeddingModel,
    Integer startOffset,
    Integer endOffset
) {
}
