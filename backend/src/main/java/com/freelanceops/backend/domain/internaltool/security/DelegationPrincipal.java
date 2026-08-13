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
    Set<String> permissions
) {
}


