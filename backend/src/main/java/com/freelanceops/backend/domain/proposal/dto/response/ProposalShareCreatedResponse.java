package com.freelanceops.backend.domain.proposal.dto.response;

import java.time.Instant;
import java.util.UUID;

public record ProposalShareCreatedResponse(
    UUID shareId,
    String token,
    String publicPath,
    Instant expiresAt,
    Instant createdAt
) {
}
