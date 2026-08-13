package com.freelanceops.backend.domain.quotation.dto.response;

import java.math.BigDecimal;
import java.util.UUID;

public record EstimationPolicyResponse(UUID workspaceId, BigDecimal defaultTaxRate, BigDecimal defaultRiskBufferRate, BigDecimal maximumDiscountRate, long version) {
}
