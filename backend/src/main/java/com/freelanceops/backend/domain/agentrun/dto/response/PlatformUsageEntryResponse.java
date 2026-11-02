package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage;

import io.swagger.v3.oas.annotations.media.Schema;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Schema(name = "UsageEntry")
public record PlatformUsageEntryResponse(
        UUID runId,
        String model,
        String status,
        Instant startedAt,
        BigDecimal platformCostUsd,
        BigDecimal platformReservedUsd,
        boolean usageKnown,
        long byokInputTokens,
        long byokOutputTokens,
        List<ProviderCallUsage> providerCalls) {}
