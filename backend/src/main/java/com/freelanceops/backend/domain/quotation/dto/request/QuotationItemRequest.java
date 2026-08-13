package com.freelanceops.backend.domain.quotation.dto.request;

import com.freelanceops.backend.domain.quotation.model.WorkUnit;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.UUID;

public record QuotationItemRequest(
    UUID rateCardId,
    @NotBlank @Size(max = 200) String title,
    @Size(max = 5000) String description,
    @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal quantity,
    WorkUnit unit,
    @DecimalMin("0") BigDecimal unitRate,
    @NotNull @DecimalMin("0") @DecimalMax("1") BigDecimal discountRate,
    @NotNull @Valid QuotationBasisRequest basis
) {
}
