package com.freelanceops.backend.domain.quotation.client.dto.request;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.TrustedRunContext;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;

import java.math.BigDecimal;

public record InternalAssumptionSuggestionRequest(
    TrustedRunContext context,
    ModelSelection modelSelection,
    String projectRequirement,
    String itemTitle,
    String itemDescription,
    BigDecimal quantity,
    String unit,
    String currentAssumption
) {
}
