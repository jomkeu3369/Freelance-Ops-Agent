package com.freelanceops.backend.domain.quotation.dto.response;

import com.freelanceops.backend.domain.quotation.model.QuotationScenario;
import com.freelanceops.backend.domain.quotation.model.QuotationStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record QuotationResponse(
    UUID id, UUID workspaceId, UUID projectId, UUID seriesId, UUID previousVersionId, int versionNumber,
    QuotationScenario scenario, QuotationStatus status, String currency, BigDecimal subtotal,
    BigDecimal discountTotal, BigDecimal riskBufferRate, BigDecimal riskBufferAmount,
    BigDecimal taxRate, BigDecimal taxAmount, BigDecimal total, LocalDate validUntil,
    List<QuotationItemResponse> items, Instant publishedAt, UUID createdBy, Instant createdAt, long version
) {
}
