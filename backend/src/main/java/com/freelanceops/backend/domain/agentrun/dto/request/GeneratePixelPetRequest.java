package com.freelanceops.backend.domain.agentrun.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

@Schema(name = "Generate")
public record GeneratePixelPetRequest(
        @NotNull UUID projectId, @NotNull @Valid ComposeCustomAgentPetRequest input) {}
