package com.freelanceops.backend.domain.agentrun.dto.request;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@Schema(name = "Generate")
public record GeneratePetRequest(
        @NotNull @Valid ModelSelection modelSelection,
        @NotBlank @Size(max = 500) String description,
        @NotNull @Pattern(regexp = "LEAN|RECOMMENDED|EXPANDED") String slot) {}
