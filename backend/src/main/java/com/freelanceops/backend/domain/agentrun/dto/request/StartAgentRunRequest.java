package com.freelanceops.backend.domain.agentrun.dto.request;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

public record StartAgentRunRequest(
    @NotBlank @Size(max = 50000) String requirementText,
    @NotBlank @Size(max = 20) String locale,
    @Size(max = 32) String jurisdictionCode,
    @NotNull @Valid ModelSelection modelSelection,
    @NotNull @Valid RunBudget budget,
    @NotNull @Valid SafetyContext safetyContext,
    @Valid CreditQuote creditQuote,
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_EMPTY)
    @Size(max = 6) java.util.List<@NotNull UUID> attachmentIds
) {

    public StartAgentRunRequest {
        attachmentIds = attachmentIds == null ? java.util.List.of() : java.util.List.copyOf(attachmentIds);
    }

    public StartAgentRunRequest(String requirementText, String locale, String jurisdictionCode, ModelSelection modelSelection,
                                RunBudget budget, SafetyContext safetyContext, CreditQuote creditQuote) {
        this(requirementText, locale, jurisdictionCode, modelSelection, budget, safetyContext, creditQuote, java.util.List.of());
    }

    public StartAgentRunRequest(String requirementText, String locale, String jurisdictionCode, ModelSelection modelSelection,
                                RunBudget budget, SafetyContext safetyContext) {
        this(requirementText, locale, jurisdictionCode, modelSelection, budget, safetyContext, null);
    }

    public record CreditQuote(@Min(1) @Max(100000) int credits, @NotNull java.time.Instant pricingUpdatedAt) { }

    public record ModelSelection(
        @NotNull Provider provider,
        @NotBlank @Size(max = 100) String model,
        @NotNull ReasoningEffort reasoningEffort,
        java.util.UUID credentialId
    ) {
        public ModelSelection(Provider provider, String model, ReasoningEffort reasoningEffort) {
            this(provider, model, reasoningEffort, null);
        }
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
