package com.freelanceops.backend.domain.agentrun.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

public record ResumeAgentRunRequest(
    @NotNull UUID interruptionId,
    @NotBlank @Size(min = 8, max = 128) String idempotencyKey,
    @NotNull @Size(min = 1, max = 100) List<@Valid ResumeAnswer> answers
) {

    public record ResumeAnswer(
        @Min(0) int questionIndex,
        @NotBlank @Size(max = 5000) String answer
    ) {
    }
}
