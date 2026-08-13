package com.freelanceops.backend.domain.agentrun.dto.request;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record StartAgentRunRequest(
    @NotBlank @Size(max = 50000) String requirementText,
    @NotBlank @Size(max = 20) String locale,
    @Size(max = 32) String jurisdictionCode,
    @NotNull @Valid ModelSelection modelSelection,
    @NotNull @Valid RunBudget budget,
    @NotNull @Valid SafetyContext safetyContext
) {

    public record ModelSelection(
        @NotNull Provider provider,
        @NotBlank @Size(max = 100) String model,
        @NotNull ReasoningEffort reasoningEffort
    ) {
    }

    public record RunBudget(
        @Min(1) @Max(900) int maxDurationSeconds,
        @Min(0) @Max(50) int maxModelCalls,
        @Min(0) @Max(100) int maxToolCalls,
        @Min(0) int maxInputTokens,
        @Min(0) int maxOutputTokens,
        @Min(1) @Max(4) int maxDepartments,
        @Min(1) @Max(2) int maxHierarchyDepth,
        @Min(0) @Max(100) int maxSearchCredits,
        @Min(0) @Max(5) int maxRetries,
        @Min(0) @Max(10) int maxHandoffs
    ) {
    }

    public record SafetyContext(
        boolean externalSideEffect,
        boolean sensitiveData,
        boolean financialAuthorityRequired,
        boolean legalAuthorityRequired,
        boolean irreversibleAction,
        boolean approvalRequired,
        boolean authorityVerified
    ) {
    }
}
