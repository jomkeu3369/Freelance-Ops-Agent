package com.freelanceops.backend.domain.quotation.client.dto.response;

import com.freelanceops.backend.domain.agentrun.model.Provider;

import java.util.UUID;

public record InternalAssumptionSuggestionResponse(
    UUID runId,
    String content,
    Provider provider,
    String model,
    Usage usage
) {
    public record Usage(
        long modelCalls,
        long inputTokens,
        long outputTokens,
        long retryCount,
        long durationMs
    ) {
    }
}
