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
    PlatformBudget platformBudget
) {

    public InternalAgentRunRequest(TrustedRunContext context, RunBudget budget, ModelSelection modelSelection,
                                   SafetyContext safetyContext, AgentInput input) {
        this(context, budget, modelSelection, safetyContext, input, null);
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
        List<com.freelanceops.backend.domain.agentrun.dto.PetProfile> petProfiles
    ) {
        public AgentInput(String requirementText, String locale, String jurisdictionCode, String directToolOperation) {
            this(requirementText, locale, jurisdictionCode, directToolOperation, List.of());
        }
    }
}
