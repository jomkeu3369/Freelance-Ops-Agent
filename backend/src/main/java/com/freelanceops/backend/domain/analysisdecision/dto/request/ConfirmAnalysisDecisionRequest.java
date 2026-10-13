package com.freelanceops.backend.domain.analysisdecision.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record ConfirmAnalysisDecisionRequest(
    @NotBlank @Pattern(regexp = "[a-f0-9]{64}") String expectedContentHash,
    @NotBlank @Pattern(regexp = "CONFIRM_ANALYSIS_DECISION") String confirmation
) { }
