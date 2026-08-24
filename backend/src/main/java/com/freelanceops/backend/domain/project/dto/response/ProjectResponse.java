package com.freelanceops.backend.domain.project.dto.response;

import com.freelanceops.backend.domain.project.model.ProjectStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record ProjectResponse(
    UUID id,
    UUID workspaceId,
    UUID clientId,
    String title,
    String requirementText,
    String currency,
    LocalDate deadline,
    BigDecimal budgetMin,
    BigDecimal budgetMax,
    ProjectStatus status,
    UUID createdBy,
    Instant createdAt,
    Instant updatedAt,
    long version
) {
}
