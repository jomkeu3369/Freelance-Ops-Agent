package com.freelanceops.backend.domain.quotation.dto.response;

import com.freelanceops.backend.domain.agentrun.model.Provider;

import java.util.UUID;

public record QuotationAssumptionSuggestionResponse(
    UUID requestId,
    String content,
    Provider provider,
    String model
) {
}
