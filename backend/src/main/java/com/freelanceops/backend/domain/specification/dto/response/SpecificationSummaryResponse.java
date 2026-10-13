package com.freelanceops.backend.domain.specification.dto.response;

import java.time.Instant;
import java.util.UUID;

/** History listing does not repeatedly transfer large bodies or provenance snapshots. */
public record SpecificationSummaryResponse(UUID id, int revisionNumber, String status, String title,
    String contentHash, UUID sourceDecisionId, int sourceDecisionVersion, boolean sourceCurrent,
    Instant createdAt, Instant confirmedAt) {}
