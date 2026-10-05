package com.freelanceops.backend.domain.quotation.dto.request;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

/** Confirmation token refers to the server-stored snapshot, not caller-supplied rates. */
public record ConfirmEstimationPolicyProposalRequest(@NotNull UUID confirmationToken) {
}
