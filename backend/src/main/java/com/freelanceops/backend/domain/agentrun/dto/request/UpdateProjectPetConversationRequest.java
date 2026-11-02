package com.freelanceops.backend.domain.agentrun.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

@Schema(name = "Update")
public record UpdateProjectPetConversationRequest(
        boolean petMode,
        boolean debateEnabled,
        @NotNull @Size(max = 3) List<@NotNull UUID> participantPetIds,
        @Min(0) long expectedVersion) {}
