package com.freelanceops.backend.domain.agentrun.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

@Schema(name = "Change")
public record ChangeCustomAgentPetRequest(
        @NotNull @Pattern(regexp = "SELECT|ARCHIVE|RESTORE") String action,
        @Min(1) long expectedRevision) {}
