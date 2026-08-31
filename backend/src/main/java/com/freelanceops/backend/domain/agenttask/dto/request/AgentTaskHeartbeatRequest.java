package com.freelanceops.backend.domain.agenttask.dto.request;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record AgentTaskHeartbeatRequest(
    @Min(1) int expectedTaskRevision,
    @Min(1) int attemptNumber,
    @NotBlank @Size(max = 100) String phase,
    @NotBlank @Size(max = 300) String activity
) {
}
