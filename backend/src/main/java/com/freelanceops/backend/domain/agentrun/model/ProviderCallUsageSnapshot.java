package com.freelanceops.backend.domain.agentrun.model;

import java.math.BigDecimal;
import java.util.UUID;

/** provider_calls JSONB의 저장 형식. API 응답 타입이나 현재 모델 카탈로그에 의존하지 않는다. */
public record ProviderCallUsageSnapshot(
        UUID callId,
        Provider provider,
        String model,
        String operation,
        long inputTokens,
        long outputTokens,
        long cachedReadTokens,
        long cacheWriteTokens,
        BigDecimal costUsd,
        BigDecimal reservedCostUsd,
        boolean usageKnown,
        String fundingSource) {
    public ProviderCallUsageSnapshot {
        if (!("PLATFORM".equals(fundingSource) || "BYOK".equals(fundingSource))) {
            throw new IllegalArgumentException("Provider funding source must be explicit");
        }
        if (callId == null
                || provider == null
                || model == null
                || operation == null
                || inputTokens < 0
                || outputTokens < 0
                || cachedReadTokens < 0
                || cacheWriteTokens < 0
                || cachedReadTokens > inputTokens
                || cacheWriteTokens > inputTokens - cachedReadTokens
                || costUsd == null
                || costUsd.signum() < 0
                || reservedCostUsd == null
                || reservedCostUsd.signum() < 0) {
            throw new IllegalArgumentException("Invalid per-attempt provider usage");
        }
    }
}
