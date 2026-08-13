package com.freelanceops.backend.domain.proposal.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

public record CreateProposalShareRequest(
    @Min(1) @Max(30) int expiresInDays
) {
}
