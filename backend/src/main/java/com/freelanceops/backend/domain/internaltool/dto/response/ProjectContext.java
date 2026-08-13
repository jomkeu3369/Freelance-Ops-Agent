package com.freelanceops.backend.domain.internaltool.dto.response;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

public record ProjectContext(
    UUID projectId,
    UUID workspaceId,
    String title,
    String requirementText,
    String currency,
    LocalDate deadline,
    BigDecimal budgetMin,
    BigDecimal budgetMax
) {
}
