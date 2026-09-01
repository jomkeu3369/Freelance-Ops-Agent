package com.freelanceops.backend.domain.knowledge.dto.request;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import jakarta.validation.constraints.*;

public record CreateRaptorIndexRequest(@NotNull Provider provider, @NotBlank @Size(max = 100) String embeddingModel, @NotBlank @Size(max = 100) String summaryModel, @Min(2) @Max(50) int targetClusterSize, @Min(1) @Max(8) int maxSummaryLevels, @Min(1) @Max(100) int kmeansIterations) {
}
