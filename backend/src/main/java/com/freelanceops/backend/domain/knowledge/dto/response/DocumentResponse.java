package com.freelanceops.backend.domain.knowledge.dto.response;

import com.freelanceops.backend.domain.knowledge.model.KnowledgeSourceType;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record DocumentResponse(
    UUID id, UUID workspaceId, KnowledgeSourceType sourceType, String title, String sourceUri,
    String sourceVersion, String jurisdiction, LocalDate effectiveFrom, LocalDate effectiveUntil,
    String contentSha256, String status, List<DocumentChunkResponse> chunks,
    UUID createdBy, Instant createdAt, long version
) {
}
