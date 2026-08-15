package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.DepartmentName;
import com.freelanceops.backend.domain.agentrun.model.InterruptionKind;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.RequestTier;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record AgentRunView(
    UUID runId,
    AgentRunStatus status,
    DepartmentName activeDepartment,
    AgentInterruption interruption,
    AgentRunResult result,
    String errorCode,
    AgentRunMetadata metadata,
    AgentRunUsage usage,
    Instant updatedAt
) {

    public record AgentInterruption(UUID interruptionId, InterruptionKind kind, List<String> questions) {
    }

    public record AgentRunResult(
        String projectSummary,
        List<String> openQuestions,
        List<DepartmentResult> departmentResults,
        QuotationDraft quotationDraft
    ) {
    }

    public record QuotationDraft(String scenario, List<QuotationDraftItem> items) {
    }

    public record QuotationDraftItem(
        String title,
        String description,
        double quantity,
        String unit,
        String rateCardHint,
        QuotationDraftBasis basis
    ) {
    }

    public record QuotationDraftBasis(
        String type,
        String content,
        String sourceReference,
        String sourceTitle
    ) {
    }

    public record DepartmentResult(
        DepartmentName department,
        String status,
        String summary,
        List<UUID> evidenceIds,
        List<UUID> assumptionIds,
        List<SourceReference> sources,
        String errorCode
    ) {
    }

    public record SourceReference(
        String title,
        String url,
        String provider,
        String contentSha256,
        Instant fetchedAt,
        String authorityLevel,
        String jurisdiction,
        String excerpt
    ) {
    }

    public record AgentRunMetadata(
        Provider provider,
        String model,
        String promptVersion,
        String toolSchemaVersion,
        String traceId
    ) {
    }

    public record AgentRunUsage(
        RequestTier requestTier,
        long modelCalls,
        long toolCalls,
        long inputTokens,
        long outputTokens,
        long cachedTokens,
        long searchCredits,
        long crawledPages,
        long retryCount,
        long durationMs
    ) {
        public AgentRunUsage {
            if (requestTier == null || modelCalls < 0 || toolCalls < 0 || inputTokens < 0 || outputTokens < 0
                || cachedTokens < 0 || searchCredits < 0 || crawledPages < 0 || retryCount < 0 || durationMs < 0) {
                throw new IllegalArgumentException("Agent run usage values must not be negative");
            }
            if (cachedTokens > inputTokens) throw new IllegalArgumentException("cached tokens exceed input tokens");
        }
    }
}
