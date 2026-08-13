package com.freelanceops.backend.domain.proposal.dto.request;

import com.freelanceops.backend.domain.proposal.model.ProposalDecision;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record SubmitProposalDecisionRequest(
    @NotNull ProposalDecision decision,
    @NotBlank @Size(max = 120) String clientName,
    @Email @Size(max = 320) String clientEmail,
    @Size(max = 3000) String comment
) {
}
