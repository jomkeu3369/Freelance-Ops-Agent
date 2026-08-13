package com.freelanceops.backend.domain.proposal.dto.response;

import com.freelanceops.backend.domain.proposal.model.ProposalDecision;

import java.time.Instant;
import java.util.UUID;

public record ProposalDecisionResponse(
    UUID decisionId,
    UUID quotationId,
    ProposalDecision decision,
    String clientName,
    String comment,
    Instant decidedAt
) {
}
