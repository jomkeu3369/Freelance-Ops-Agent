package com.freelanceops.backend.domain.agentrun.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

@Schema(name = "Usage")
public record PlatformUsageResponse(
        String currency,
        BigDecimal limitUsd,
        BigDecimal settledUsd,
        BigDecimal reservedUsd,
        BigDecimal remainingUsd,
        BigDecimal remainingPercent,
        BigDecimal reservedPercent,
        LocalDate periodStart,
        Instant resetAt,
        String timezone,
        boolean spendingEnabled,
        List<PlatformUsageModelResponse> models) {}
