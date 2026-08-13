package com.freelanceops.backend.domain.outcome.dto.request;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.UUID;

public record ActualWorkItemRequest(
    UUID quotationItemId,
    @NotBlank @Size(max = 200) String title,
    @NotNull @DecimalMin("0") BigDecimal actualHours,
    @NotNull @DecimalMin("0") BigDecimal actualCost,
    @Size(max = 3000) String notes
) {
}
