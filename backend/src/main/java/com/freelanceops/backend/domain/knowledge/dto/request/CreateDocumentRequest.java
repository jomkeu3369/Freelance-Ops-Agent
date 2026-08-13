package com.freelanceops.backend.domain.knowledge.dto.request;

import com.freelanceops.backend.domain.knowledge.model.KnowledgeSourceType;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

public record CreateDocumentRequest(
    @NotNull KnowledgeSourceType sourceType,
    @NotBlank @Size(max = 300) String title,
    @Size(max = 2000) String sourceUri,
    @Size(max = 120) String sourceVersion,
    @Size(max = 120) String jurisdiction,
    LocalDate effectiveFrom,
    LocalDate effectiveUntil,
    @NotNull @Size(min = 1, max = 1000) List<@Valid DocumentChunkRequest> chunks
) {
}
