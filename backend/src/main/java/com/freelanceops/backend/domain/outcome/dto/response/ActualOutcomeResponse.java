package com.freelanceops.backend.domain.outcome.dto.response;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record ActualOutcomeResponse(
    UUID id, UUID workspaceId, UUID projectId, UUID approvedQuotationId, BigDecimal totalRevenue,
    BigDecimal actualCost, BigDecimal actualHours, BigDecimal profitAmount, BigDecimal profitMargin,
    LocalDate completedOn, String changeReason, List<ActualWorkItemResponse> workItems, long version
) {
}
