package com.freelanceops.backend.domain.agentrun.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.math.BigDecimal;
import java.util.List;

@Schema(name = "Model")
public record PlatformUsageModelResponse(
        String provider,
        String model,
        boolean catalogued,
        boolean enabled,
        List<String> reasoningEfforts,
        BigDecimal maxRunUsd,
        boolean available,
        String unavailableReason,
        boolean providerAccessVerified) {}
