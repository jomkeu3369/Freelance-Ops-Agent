package com.freelanceops.backend.domain.quotation.dto.request;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.UUID;

/** A typed change proposed by the chat UI, never an instruction to write immediately. */
public record ProposeEstimationPolicyRequest(
    @NotNull @DecimalMin("0") @DecimalMax("1") @Digits(integer = 1, fraction = 6) BigDecimal defaultTaxRate,
    @NotNull @DecimalMin("0") @DecimalMax("1") @Digits(integer = 1, fraction = 6) BigDecimal defaultRiskBufferRate,
    @NotNull @DecimalMin("0") @DecimalMax("1") @Digits(integer = 1, fraction = 6) BigDecimal maximumDiscountRate,
    @NotNull @PositiveOrZero Long expectedVersion,
    @NotNull UUID idempotencyKey,
    @NotNull UUID projectId,
    @NotBlank @Size(max = 50000) String sourceMessage
) {
}
