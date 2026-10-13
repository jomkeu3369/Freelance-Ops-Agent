package com.freelanceops.backend.domain.specification.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** An already-confirmed result, loaded from server-owned provenance. */
public record ConfirmedAnalysisSource(
    UUID decisionId, int decisionVersion, String bodyText, String contentHash,
    UUID runId, long projectVersion, List<String> selectedOpinionIds,
    Map<String, Object> provenance, UUID confirmedBy, Instant confirmedAt
) {
    public ConfirmedAnalysisSource {
        selectedOpinionIds = List.copyOf(selectedOpinionIds);
        provenance = java.util.Collections.unmodifiableMap(new java.util.LinkedHashMap<>(provenance));
    }
}
