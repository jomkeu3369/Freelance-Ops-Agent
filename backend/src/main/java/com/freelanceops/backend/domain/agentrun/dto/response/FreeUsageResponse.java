package com.freelanceops.backend.domain.agentrun.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.List;

@Schema(name = "Usage")
public record FreeUsageResponse(
        int limit,
        int used,
        int reserved,
        int remaining,
        Instant resetAt,
        String period,
        String timezone,
        long epoch,
        boolean canManage,
        String unit,
        String periodType,
        List<FreeUsageModelRateResponse> modelRates,
        Instant pricingUpdatedAt) {
    public FreeUsageResponse(
            int limit,
            int used,
            int reserved,
            int remaining,
            Instant resetAt,
            String period,
            String timezone,
            long epoch,
            boolean canManage) {
        this(
                limit, used, reserved, remaining, resetAt, period, timezone, epoch, canManage,
                "CREDITS", "WEEKLY", List.of(), null);
    }
}
