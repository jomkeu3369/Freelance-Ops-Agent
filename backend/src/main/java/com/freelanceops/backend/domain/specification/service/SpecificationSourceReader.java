package com.freelanceops.backend.domain.specification.service;

import com.freelanceops.backend.domain.specification.model.ConfirmedAnalysisSource;
import java.util.UUID;

/** Keeps the specification flow independent from synthesis implementation details. */
public interface SpecificationSourceReader {
    ConfirmedAnalysisSource getConfirmed(UUID userId, UUID workspaceId, UUID projectId, UUID decisionId);
    java.util.Optional<UUID> latestConfirmedId(UUID userId, UUID workspaceId, UUID projectId);
    default boolean isLatestConfirmed(UUID userId, UUID workspaceId, UUID projectId, UUID decisionId) {
        return latestConfirmedId(userId, workspaceId, projectId).map(decisionId::equals).orElse(false);
    }
}
