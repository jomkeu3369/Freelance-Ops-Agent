package com.freelanceops.backend.domain.agentrun.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

@Schema(name = "Compose")
public record ComposeCustomAgentPetRequest(
        @NotNull UUID id,
        @NotNull UUID mutationId,
        @Min(0) long expectedRevision,
        @NotBlank @Size(max = 500) String description,
        boolean resetPreferences,
        UUID generationId) {
    public ComposeCustomAgentPetRequest(
            UUID id,
            UUID mutationId,
            long expectedRevision,
            String description,
            boolean resetPreferences) {
        this(id, mutationId, expectedRevision, description, resetPreferences, null);
    }
}
