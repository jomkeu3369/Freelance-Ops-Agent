package com.freelanceops.backend.domain.specification.dto.response;

import com.freelanceops.backend.domain.memory.dto.response.MemorySourceMessage;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record SpecificationResponse(
    UUID id, UUID workspaceId, UUID projectId, int revisionNumber, UUID supersedes,
    String status, String title, String bodyText, String contentHash,
    UUID sourceDecisionId, int sourceDecisionVersion, String sourceDecisionHash,
    String sourceBodyText, UUID sourceRunId, long sourceProjectVersion,
    Map<String, Object> sourceProvenance, List<MemorySourceMessage> originalSources,
    UUID createdBy, Instant createdAt, UUID confirmedBy, Instant confirmedAt,
    UUID reusableDocumentId, String indexStatus, boolean sourceCurrent, String downloadFileName
) {}
