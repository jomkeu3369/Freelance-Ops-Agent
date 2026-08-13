package com.freelanceops.backend.domain.outcome.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record UpsertActualOutcomeRequest(
    UUID approvedQuotationId,
    @NotNull @DecimalMin("0") BigDecimal totalRevenue,
    @NotNull @DecimalMin("0") BigDecimal actualCost,
    @NotNull @DecimalMin("0") BigDecimal actualHours,
    LocalDate completedOn,
    @Size(max = 5000) String changeReason,
    @NotNull @Size(max = 200) List<@Valid ActualWorkItemRequest> workItems
) {
}
