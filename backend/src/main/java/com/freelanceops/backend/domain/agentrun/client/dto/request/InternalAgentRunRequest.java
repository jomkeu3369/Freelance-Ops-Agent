package com.freelanceops.backend.domain.agentrun.client.dto.request;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.SafetyContext;

import java.util.List;
import java.util.UUID;

public record InternalAgentRunRequest(
    TrustedRunContext context,
    RunBudget budget,
    ModelSelection modelSelection,
    SafetyContext safetyContext,
    AgentInput input,
    PlatformBudget platformBudget,
    ByokBudget byokBudget
) {

    public InternalAgentRunRequest(TrustedRunContext context, RunBudget budget, ModelSelection modelSelection,
                                   SafetyContext safetyContext, AgentInput input, PlatformBudget platformBudget) {
        this(context, budget, modelSelection, safetyContext, input, platformBudget, null);
    }

    public InternalAgentRunRequest(TrustedRunContext context, RunBudget budget, ModelSelection modelSelection,
                                   SafetyContext safetyContext, AgentInput input) {
        this(context, budget, modelSelection, safetyContext, input, null);
    }

    /** Issued only by Spring. A scope is not a credential or a reusable call permit. */
    public record ByokBudget(UUID scopeId, UUID runId, UUID workspaceId, UUID projectId, UUID initiatedBy,
                             UUID credentialId, com.freelanceops.backend.domain.agentrun.model.Provider provider,
                             String model, com.freelanceops.backend.domain.agentrun.model.ReasoningEffort reasoningEffort,
                             String fundingSource, String serviceTier, java.time.Instant validUntil,
                             int maxModelCalls, int maxInputTokens, int maxOutputTokens, RunBudget budget,
                             @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
                             String costNoticeVersion) {
        /** Legacy persisted scopes omit notice provenance; reading them never mints or renews one. */
        public ByokBudget(UUID scopeId, UUID runId, UUID workspaceId, UUID projectId, UUID initiatedBy,
                          UUID credentialId, com.freelanceops.backend.domain.agentrun.model.Provider provider,
                          String model, com.freelanceops.backend.domain.agentrun.model.ReasoningEffort reasoningEffort,
                          String fundingSource, String serviceTier, java.time.Instant validUntil,
                          int maxModelCalls, int maxInputTokens, int maxOutputTokens, RunBudget budget) {
            this(scopeId, runId, workspaceId, projectId, initiatedBy, credentialId, provider, model, reasoningEffort,
                fundingSource, serviceTier, validUntil, maxModelCalls, maxInputTokens, maxOutputTokens, budget, null);
        }
        public ByokBudget {
            if (scopeId == null || runId == null || workspaceId == null || projectId == null || initiatedBy == null
                || credentialId == null || provider == null || model == null || reasoningEffort == null || validUntil == null
                || !"BYOK".equals(fundingSource) || !"default".equals(serviceTier) || budget == null
                || maxModelCalls != budget.maxModelCalls() || maxInputTokens != budget.maxInputTokens()
                || maxOutputTokens != budget.maxOutputTokens() || maxModelCalls < 1 || maxInputTokens < 1 || maxOutputTokens < 1) {
                throw new IllegalArgumentException("Personal execution scope is invalid");
            }
        }
    }

    public record PlatformBudget(UUID reservationId, java.math.BigDecimal maxCostUsd,
                                 String tariffVersion, java.time.Instant validUntil) {
        public PlatformBudget {
            if (reservationId == null || maxCostUsd == null || maxCostUsd.signum() <= 0
                || maxCostUsd.compareTo(new java.math.BigDecimal("100")) > 0
                || tariffVersion == null || validUntil == null) throw new IllegalArgumentException("Platform budget is invalid");
        }
    }

    public record TrustedRunContext(
        UUID runId,
        UUID threadId,
        String traceId,
        UUID workspaceId,
        UUID projectId,
        UUID initiatedBy,
        List<String> effectivePermissions
    ) {
    }

    public record AgentInput(
        String requirementText,
        String locale,
        String jurisdictionCode,
        String directToolOperation,
        List<com.freelanceops.backend.domain.agentrun.dto.PetProfile> petProfiles,
        List<com.freelanceops.backend.domain.agentrun.dto.AttachmentText> attachments,
        com.freelanceops.backend.domain.agentrun.dto.SkillSelection skillSelection,
        String workflowMode
    ) {
        public AgentInput {
            workflowMode = workflowMode == null ? "PROJECT_ANALYSIS" : workflowMode;
            if (!(workflowMode.equals("PROJECT_ANALYSIS") || workflowMode.equals("AD_HOC"))) throw new IllegalArgumentException("Invalid workflow mode");
            attachments = attachments == null ? List.of() : List.copyOf(attachments);
        }
        public AgentInput(String requirementText, String locale, String jurisdictionCode, String directToolOperation,
                          List<com.freelanceops.backend.domain.agentrun.dto.PetProfile> petProfiles,
                          List<com.freelanceops.backend.domain.agentrun.dto.AttachmentText> attachments,
                          com.freelanceops.backend.domain.agentrun.dto.SkillSelection skillSelection) {
            this(requirementText, locale, jurisdictionCode, directToolOperation, petProfiles, attachments, skillSelection, null);
        }
        public AgentInput(String requirementText, String locale, String jurisdictionCode, String directToolOperation,
                          List<com.freelanceops.backend.domain.agentrun.dto.PetProfile> petProfiles,
                          List<com.freelanceops.backend.domain.agentrun.dto.AttachmentText> attachments) {
            this(requirementText, locale, jurisdictionCode, directToolOperation, petProfiles, attachments, null);
        }
        public AgentInput(String requirementText, String locale, String jurisdictionCode, String directToolOperation,
                          List<com.freelanceops.backend.domain.agentrun.dto.PetProfile> petProfiles) {
            this(requirementText, locale, jurisdictionCode, directToolOperation, petProfiles, List.of());
        }
        public AgentInput(String requirementText, String locale, String jurisdictionCode, String directToolOperation) {
            this(requirementText, locale, jurisdictionCode, directToolOperation, List.of());
        }
    }
}
