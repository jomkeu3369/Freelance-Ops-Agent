package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.CostStatus;
import com.freelanceops.backend.domain.agentrun.model.RequestTier;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record AgentRunUsageResponse(
    UUID runId,
    RequestTier requestTier,
    long modelCalls,
    long toolCalls,
    long inputTokens,
    long outputTokens,
    long cachedTokens,
    long searchCredits,
    long crawledPages,
    long retryCount,
    long durationMs,
    UUID pricingSnapshotId,
    BigDecimal actualCost,
    String costCurrency,
    CostStatus costStatus,
    boolean billableOutcome,
    Instant recordedAt
) { }
