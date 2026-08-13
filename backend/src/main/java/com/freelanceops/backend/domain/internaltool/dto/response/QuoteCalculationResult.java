package com.freelanceops.backend.domain.internaltool.dto.response;

import java.math.BigDecimal;

public record QuoteCalculationResult(
    String currency,
    BigDecimal subtotal,
    BigDecimal discountAmount,
    BigDecimal taxAmount,
    BigDecimal total,
    String formulaVersion
) {
}
