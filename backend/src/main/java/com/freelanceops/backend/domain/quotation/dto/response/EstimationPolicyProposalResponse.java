package com.freelanceops.backend.domain.quotation.dto.response;

import java.time.Instant;
import java.util.UUID;

public record EstimationPolicyProposalResponse(
    UUID proposalId,
    UUID workspaceId,
    UUID projectId,
    String sourceMessage,
    String status,
    EstimationPolicyResponse before,
    EstimationPolicyResponse after,
    UUID confirmationToken,
    Instant createdAt,
    Instant expiresAt,
    Instant appliedAt
) {
}
