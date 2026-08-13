package com.freelanceops.backend.domain.quotation.dto.request;

import com.freelanceops.backend.domain.quotation.model.QuotationScenario;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public record CreateQuotationRequest(
    @NotNull QuotationScenario scenario,
    @NotBlank @Pattern(regexp = "^[A-Z]{3}$") String currency,
    @DecimalMin("0") @DecimalMax("1") BigDecimal taxRate,
    boolean applyDefaultRiskBuffer,
    LocalDate validUntil,
    @NotNull @Size(min = 1, max = 200) List<@Valid QuotationItemRequest> items
) {
}
