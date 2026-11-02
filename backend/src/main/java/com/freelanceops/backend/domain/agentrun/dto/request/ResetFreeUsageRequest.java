package com.freelanceops.backend.domain.agentrun.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;

@Schema(name = "ResetAll")
public record ResetFreeUsageRequest(
        @NotNull String confirmation,
        @NotNull @Min(0) Long expectedEpoch,
        @NotNull Instant expectedUpdatedAt) {}
