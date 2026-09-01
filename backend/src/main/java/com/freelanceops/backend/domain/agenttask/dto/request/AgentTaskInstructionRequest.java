package com.freelanceops.backend.domain.agenttask.dto.request;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record AgentTaskInstructionRequest(
    @Min(1) int expectedRevision,
    @NotBlank @Size(max = 128) String idempotencyKey,
    @NotBlank @Size(max = 4000) String instruction
) {
}
