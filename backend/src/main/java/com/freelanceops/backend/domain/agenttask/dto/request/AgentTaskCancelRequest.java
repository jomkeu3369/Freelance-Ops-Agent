package com.freelanceops.backend.domain.agenttask.dto.request;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record AgentTaskCancelRequest(
    @Min(1) int expectedRevision,
    @NotBlank @Size(max = 128) String idempotencyKey
) {
}
