package com.freelanceops.backend.domain.agentrun.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.List;

@Schema(name = "Settings")
public record FreeUsageSettingsResponse(
        int limit,
        int maxLimit,
        long epoch,
        Instant updatedAt,
        Instant lastResetAt,
        List<FreeUsageModelRateResponse> modelRates,
        String unit,
        String periodType) {
    public FreeUsageSettingsResponse(
            int limit, int maxLimit, long epoch, Instant updatedAt, Instant lastResetAt) {
        this(limit, maxLimit, epoch, updatedAt, lastResetAt, List.of(), "CREDITS", "WEEKLY");
    }
}
