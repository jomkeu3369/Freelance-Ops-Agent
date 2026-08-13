package com.freelanceops.backend.domain.quotation.dto.request;

import com.freelanceops.backend.domain.quotation.model.WorkUnit;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

public record UpsertRateCardRequest(
    @NotBlank @Size(max = 120) String name,
    @NotNull WorkUnit unit,
    @NotNull @DecimalMin("0") BigDecimal rate,
    @NotNull @DecimalMin("0") BigDecimal minimumAmount,
    @NotBlank @Pattern(regexp = "^[A-Z]{3}$") String currency,
    boolean active
) {
}
