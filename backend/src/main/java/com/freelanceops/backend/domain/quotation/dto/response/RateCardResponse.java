package com.freelanceops.backend.domain.quotation.dto.response;

import com.freelanceops.backend.domain.quotation.model.WorkUnit;
import java.math.BigDecimal;
import java.util.UUID;

public record RateCardResponse(UUID id, UUID workspaceId, String name, WorkUnit unit, BigDecimal rate, BigDecimal minimumAmount, String currency, boolean active, long version) {
}
