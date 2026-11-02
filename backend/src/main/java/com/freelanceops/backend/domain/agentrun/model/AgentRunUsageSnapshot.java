package com.freelanceops.backend.domain.agentrun.model;

import java.util.List;
import java.util.UUID;

/** 사용량 엔티티가 보존하는 입력. 원가 계산 결과는 엔티티 갱신 인자로 별도 전달한다. */
public record AgentRunUsageSnapshot(
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
        List<ProviderCallUsageSnapshot> providerCalls,
        UUID platformReservationId,
        String tariffVersion,
        UUID byokScopeId) {
    public AgentRunUsageSnapshot {
        providerCalls = providerCalls == null ? List.of() : List.copyOf(providerCalls);
        if (byokScopeId != null && (platformReservationId != null || tariffVersion != null))
            throw new IllegalArgumentException("Personal usage cannot claim platform funding");
        if ((platformReservationId == null) != (tariffVersion == null))
            throw new IllegalArgumentException("Platform usage provenance must be complete");
        if (providerCalls.stream().map(ProviderCallUsageSnapshot::callId).distinct().count()
                != providerCalls.size())
            throw new IllegalArgumentException("Duplicate provider attempt identity");
        if (requestTier == null
                || modelCalls < 0
                || toolCalls < 0
                || inputTokens < 0
                || outputTokens < 0
                || cachedTokens < 0
                || searchCredits < 0
                || crawledPages < 0
                || retryCount < 0
                || durationMs < 0)
            throw new IllegalArgumentException("Agent run usage values must not be negative");
        if (cachedTokens > inputTokens)
            throw new IllegalArgumentException("cached tokens exceed input tokens");
    }
}
