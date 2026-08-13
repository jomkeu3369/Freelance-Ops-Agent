package com.freelanceops.backend.domain.internaltool.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

public record QuoteCalculationRequest(
    @NotBlank @Pattern(regexp = "^[A-Z]{3}$") String currency,
    @NotNull @DecimalMin("0") @DecimalMax("1") BigDecimal taxRate,
    @NotNull @DecimalMin("0") @DecimalMax("1") BigDecimal discountRate,
    @NotEmpty @Size(max = 500) List<@Valid QuoteCalculationItem> items
) {

    public record QuoteCalculationItem(
        @NotNull UUID itemId,
        @NotNull @Positive BigDecimal quantity,
        @NotNull @DecimalMin("0") BigDecimal unitPrice
    ) {
    }
}
