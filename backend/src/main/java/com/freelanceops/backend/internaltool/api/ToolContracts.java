package com.freelanceops.backend.internaltool.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class ToolContracts {

    private ToolContracts() {
    }

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

    public record DomainPack(
        String code,
        String version,
        String scope,
        List<String> requiredFields,
        List<String> questionTemplates
    ) {
    }

    public record RequirementDraft(
        @NotNull UUID projectId,
        @NotBlank @Size(max = 10000) String summary,
        @NotNull @Size(max = 200) List<@NotBlank @Size(max = 1000) String> features,
        @NotNull @Size(max = 200) List<@NotBlank @Size(max = 1000) String> constraints,
        @NotNull @Size(max = 200) List<@NotBlank @Size(max = 1000) String> assumptions,
        @NotNull @Size(max = 100) List<@NotBlank @Size(max = 1000) String> openQuestions
    ) {
    }

    public record RequirementValidationResult(boolean valid, List<String> errors, List<String> warnings) {
    }

    public record QuoteCalculationItem(
        @NotNull UUID itemId,
        @NotNull @Positive BigDecimal quantity,
        @NotNull @DecimalMin("0") BigDecimal unitPrice
    ) {
    }

    public record QuoteCalculationRequest(
        @NotBlank @Pattern(regexp = "^[A-Z]{3}$") String currency,
        @NotNull @DecimalMin("0") @DecimalMax("1") BigDecimal taxRate,
        @NotNull @DecimalMin("0") @DecimalMax("1") BigDecimal discountRate,
        @NotEmpty @Size(max = 500) List<@Valid QuoteCalculationItem> items
    ) {
    }

    public record QuoteCalculationResult(
        String currency,
        BigDecimal subtotal,
        BigDecimal discountAmount,
        BigDecimal taxAmount,
        BigDecimal total,
        String formulaVersion
    ) {
    }
}
