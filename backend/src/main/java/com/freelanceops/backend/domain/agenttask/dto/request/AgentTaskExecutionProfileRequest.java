package com.freelanceops.backend.domain.agenttask.dto.request;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskRiskLevel;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskRoute;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskToolProfile;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record AgentTaskExecutionProfileRequest(
    @NotNull AgentTaskRoute route,
    @NotNull AgentTaskRiskLevel riskLevel,
    @NotBlank @Size(max = 100) String modelProfile,
    @NotNull AgentTaskToolProfile toolProfile,
    @NotNull Provider provider,
    @NotBlank @Size(max = 100) String model,
    @NotNull ReasoningEffort reasoningEffort,
    @NotNull @Size(max = 100) List<@NotBlank @Size(max = 100) String> permissions,
    @NotNull @Valid StartAgentRunRequest.RunBudget budget,
    @NotBlank @Size(max = 100) String routeProfileVersion,
    @NotBlank @Size(max = 100) String guardPolicyVersion
) {
    public AgentTaskExecutionProfileRequest {
        permissions = permissions == null ? null : List.copyOf(permissions);
    }
}
