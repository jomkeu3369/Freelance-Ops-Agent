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
    AgentInput input
) {

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
        String directToolOperation
    ) {
    }
}
