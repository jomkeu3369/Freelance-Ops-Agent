package com.freelanceops.backend.domain.internaltool.security;

import java.util.Set;
import java.util.UUID;

public record DelegationPrincipal(
    String subject,
    String tokenId,
    UUID runId,
    UUID workspaceId,
    UUID projectId,
    UUID initiatedBy,
    Set<String> permissions,
    java.time.Instant executionDeadline
) {
    public DelegationPrincipal(String subject, String tokenId, UUID runId, UUID workspaceId, UUID projectId,
                               UUID initiatedBy, Set<String> permissions) {
        this(subject, tokenId, runId, workspaceId, projectId, initiatedBy, permissions, null);
    }
}


