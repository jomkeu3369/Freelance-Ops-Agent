package com.freelanceops.backend.domain.agenttask.dto.request;

import com.freelanceops.backend.domain.agentrun.model.DepartmentName;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.validation.Valid;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record RegisterAgentTaskRequest(
    @NotNull UUID taskId,
    UUID parentTaskId,
    @NotNull DepartmentName department,
    @NotBlank @Size(max = 100) String specialistProfile,
    @NotBlank @Size(max = 100) String alias,
    @NotBlank @Size(max = 200) String objectiveReference,
    @Min(1) @Max(5) int priority,
    Instant deadlineAt,
    @NotNull @Size(max = 64) List<UUID> dependencyTaskIds,
    @NotNull @Valid AgentTaskExecutionProfileRequest executionProfile
) {
}
