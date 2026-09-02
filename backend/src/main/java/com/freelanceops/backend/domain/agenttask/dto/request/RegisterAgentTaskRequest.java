package com.freelanceops.backend.domain.agenttask.dto.request;

import com.freelanceops.backend.domain.agentrun.model.DepartmentName;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import jakarta.validation.Valid;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record RegisterAgentTaskRequest(
    @NotNull UUID taskId,
    @NotNull UUID attemptId,
    UUID parentTaskId,
    @NotNull DepartmentName department,
    @NotBlank @Size(max = 100) String specialistProfile,
    @NotBlank @Size(max = 100) String alias,
    @NotBlank @Size(max = 200) String objectiveReference,
    @Min(1) @Max(5) int priority,
    Instant deadlineAt,
    @NotNull @Size(max = 64) List<UUID> dependencyTaskIds,
    @PositiveOrZero Double predictedServiceRuntimeSeconds,
    @Size(max = 100) String predictionModelVersion,
    @NotNull @Size(max = 50) Map<String, Object> predictionFeatureSnapshot,
    @NotNull @Valid AgentTaskExecutionProfileRequest executionProfile
) {
    public RegisterAgentTaskRequest {
        dependencyTaskIds = dependencyTaskIds == null ? null : List.copyOf(dependencyTaskIds);
        predictionFeatureSnapshot = predictionFeatureSnapshot == null ? null : Map.copyOf(predictionFeatureSnapshot);
        if ((predictedServiceRuntimeSeconds == null) != (predictionModelVersion == null)) {
            throw new IllegalArgumentException("prediction and model version must be supplied together");
        }
    }
}
