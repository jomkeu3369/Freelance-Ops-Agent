package com.freelanceops.backend.domain.agentrun.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;
import java.time.Instant;

@Schema(name = "ChangeLimit")
public record ChangeFreeUsageLimitRequest(
        @NotNull @Min(0) @Max(100000) @Digits(integer = 6, fraction = 0) BigDecimal limit,
        @NotNull @Min(0) Long expectedEpoch,
        @NotNull Instant expectedUpdatedAt) {}
