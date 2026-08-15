package com.freelanceops.backend.domain.quotation.dto.request;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.quotation.model.WorkUnit;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

public record SuggestQuotationAssumptionRequest(
    @NotBlank @Size(max = 200) String itemTitle,
    @Size(max = 5000) String itemDescription,
    @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal quantity,
    @NotNull WorkUnit unit,
    @Size(max = 3000) String currentAssumption,
    @NotNull @Valid ModelSelection modelSelection
) {
}
