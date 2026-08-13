package com.freelanceops.backend.domain.quotation.dto.response;

import com.freelanceops.backend.domain.quotation.model.WorkUnit;
import java.math.BigDecimal;
import java.util.UUID;

public record QuotationItemResponse(UUID rateCardId, String title, String description, BigDecimal quantity, WorkUnit unit, BigDecimal unitRate, BigDecimal subtotal, BigDecimal discountRate, BigDecimal discountAmount, BigDecimal total, QuotationBasisResponse basis) {
}
