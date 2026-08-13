package com.freelanceops.backend.domain.project.dto.request;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

public record CreateProjectRequest(
    UUID clientId,
    @NotBlank @Size(max = 200) String title,
    @NotBlank @Size(max = 50000) String requirementText,
    @NotBlank @Pattern(regexp = "^[A-Z]{3}$") String currency,
    LocalDate deadline,
    @DecimalMin("0") BigDecimal budgetMin,
    @DecimalMin("0") BigDecimal budgetMax
) {
}
