package com.freelanceops.backend.domain.agentrun.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;

@Schema(name = "Exhausted")
public record FreeUsageExhaustedResponse(
        String code,
        String message,
        int limit,
        int used,
        int reserved,
        Instant resetAt,
        int requiredCredits,
        int remaining,
        String unit) {}
