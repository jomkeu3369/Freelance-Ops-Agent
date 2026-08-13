package com.freelanceops.backend.domain.quotation.dto.request;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record UpdateEstimationPolicyRequest(
    @NotNull @DecimalMin("0") @DecimalMax("1") BigDecimal defaultTaxRate,
    @NotNull @DecimalMin("0") @DecimalMax("1") BigDecimal defaultRiskBufferRate,
    @NotNull @DecimalMin("0") @DecimalMax("1") BigDecimal maximumDiscountRate
) {
}
