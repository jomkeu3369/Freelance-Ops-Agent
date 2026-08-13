package com.freelanceops.backend.domain.proposal.dto.response;

import com.freelanceops.backend.domain.quotation.model.QuotationScenario;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record SharedProposalResponse(
    UUID quotationId,
    UUID projectId,
    String projectTitle,
    int versionNumber,
    QuotationScenario scenario,
    String currency,
    BigDecimal subtotal,
    BigDecimal discountTotal,
    BigDecimal riskBufferAmount,
    BigDecimal taxAmount,
    BigDecimal total,
    LocalDate validUntil,
    Instant publishedAt,
    Instant shareExpiresAt,
    List<SharedProposalItemResponse> items
) {
}
