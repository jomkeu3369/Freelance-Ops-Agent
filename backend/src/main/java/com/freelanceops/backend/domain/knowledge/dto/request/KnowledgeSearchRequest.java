package com.freelanceops.backend.domain.knowledge.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

public record KnowledgeSearchRequest(
    @NotBlank @Size(max = 2000) String query,
    @Size(min = 1536, max = 1536) List<Float> embedding,
    @Min(1) @Max(50) int limit
) {
}
