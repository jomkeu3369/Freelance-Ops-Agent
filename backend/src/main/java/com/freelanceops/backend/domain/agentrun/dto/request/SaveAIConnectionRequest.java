package com.freelanceops.backend.domain.agentrun.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(name = "SaveConnection")
public record SaveAIConnectionRequest(
        @NotBlank @Size(max = 100) String model,
        @NotBlank @Size(min = 16, max = 512) String apiKey) {
    @Override
    public String toString() {
        return "SaveConnection[redacted]";
    }
}
