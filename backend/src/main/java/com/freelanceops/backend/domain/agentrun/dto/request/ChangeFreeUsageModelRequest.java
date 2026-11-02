package com.freelanceops.backend.domain.agentrun.dto.request;

import com.freelanceops.backend.domain.agentrun.model.Provider;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;

@Schema(name = "ChangeModel")
public record ChangeFreeUsageModelRequest(
        @NotNull Provider provider,
        @NotBlank @Size(max = 100) String model,
        @NotNull @Min(1) @Max(100000) @Digits(integer = 6, fraction = 0) BigDecimal credits,
        @NotNull Boolean enabled,
        @NotNull @Min(0) Long expectedEpoch,
        @NotNull Instant expectedUpdatedAt) {}
