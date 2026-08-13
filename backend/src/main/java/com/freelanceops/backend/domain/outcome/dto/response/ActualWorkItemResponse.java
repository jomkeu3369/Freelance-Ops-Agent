package com.freelanceops.backend.domain.outcome.dto.response;

import java.math.BigDecimal;
import java.util.UUID;

public record ActualWorkItemResponse(UUID quotationItemId, String title, BigDecimal actualHours, BigDecimal actualCost, String notes) {
}
