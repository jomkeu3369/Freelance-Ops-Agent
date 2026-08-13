package com.freelanceops.backend.domain.proposal.dto.response;

import com.freelanceops.backend.domain.quotation.dto.response.QuotationBasisResponse;
import com.freelanceops.backend.domain.quotation.model.WorkUnit;

import java.math.BigDecimal;

public record SharedProposalItemResponse(
    String title,
    String description,
    BigDecimal quantity,
    WorkUnit unit,
    BigDecimal unitRate,
    BigDecimal subtotal,
    BigDecimal discountRate,
    BigDecimal discountAmount,
    BigDecimal total,
    QuotationBasisResponse basis
) {
}
