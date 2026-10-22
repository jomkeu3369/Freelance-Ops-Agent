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
        Instant updatedAt) {

    public record AgentInterruption(
            UUID interruptionId, InterruptionKind kind, List<String> questions) {}

    public record AgentRunResult(
            String projectSummary,
            List<String> openQuestions,
            List<DepartmentResult> departmentResults,
            QuotationDraft quotationDraft,
            List<QuotationDraft> quotationDrafts,
            List<UUID> referencedDocumentIds,
            List<PetMessage> petMessages) {
        public AgentRunResult(String projectSummary, List<String> openQuestions,
                List<DepartmentResult> departmentResults, QuotationDraft quotationDraft,
                List<QuotationDraft> quotationDrafts, List<UUID> referencedDocumentIds) {
            this(projectSummary, openQuestions, departmentResults, quotationDraft, quotationDrafts, referencedDocumentIds, List.of());
        }
        public AgentRunResult(
                String projectSummary,
                List<String> openQuestions,
                List<DepartmentResult> departmentResults,
                QuotationDraft quotationDraft,
                List<QuotationDraft> quotationDrafts) {
            this(
                    projectSummary,
                    openQuestions,
                    departmentResults,
                    quotationDraft,
                    quotationDrafts,
                    List.of());
        }

        public AgentRunResult {
            petMessages = petMessages == null ? List.of() : List.copyOf(petMessages);
            referencedDocumentIds =
                    referencedDocumentIds == null ? List.of() : List.copyOf(referencedDocumentIds);
            openQuestions = openQuestions == null ? List.of() : List.copyOf(openQuestions);
            departmentResults =
                    departmentResults == null ? List.of() : List.copyOf(departmentResults);
            quotationDrafts =
                    quotationDrafts == null
                            ? (quotationDraft == null ? List.of() : List.of(quotationDraft))
                            : List.copyOf(quotationDrafts);
        }
    }

    public record PetMessage(UUID messageId, UUID speakerPetId,
            com.freelanceops.backend.domain.agentrun.dto.PetProfile speaker,
            UUID replyToMessageId, String text, List<String> evidenceRefs, List<PetEvidence> evidence) {}

    public record PetEvidence(String id, String title, String content) {}

    public record QuotationDraft(
            String scenario, List<QuotationDraftItem> items, PetPerspective petPerspective) {
        public QuotationDraft(String scenario, List<QuotationDraftItem> items) {
            this(scenario, items, null);
        }
    }

    public record PetPerspective(String proposal, String rationale, String tradeoff) {}

    public record QuotationDraftItem(
            String title,
            String description,
            double quantity,
            String unit,
            String rateCardHint,
            QuotationDraftBasis basis) {}

    public record QuotationDraftBasis(
            String type, String content, String sourceReference, String sourceTitle) {}

    public record DepartmentResult(
            DepartmentName department,
            String status,
            String summary,
            List<UUID> evidenceIds,
            List<UUID> assumptionIds,
            List<SourceReference> sources,
            String errorCode) {}

    public record SourceReference(
            String title,
            String url,
            String provider,
            String contentSha256,
            Instant fetchedAt,
            String authorityLevel,
            String jurisdiction,
            String excerpt) {}

    public record AgentRunMetadata(
            Provider provider,
            String model,
            String promptVersion,
            String toolSchemaVersion,
            String traceId,
            UUID credentialId,
            List<com.freelanceops.backend.domain.agentrun.dto.PetProfile> petProfiles,
            com.freelanceops.backend.domain.agentrun.dto.SkillSelection skillSelection,
            List<String> resolvedSkillIds,
            List<String> deferredSkillIds) {
        public AgentRunMetadata(
                Provider provider,
                String model,
                String promptVersion,
                String toolSchemaVersion,
                String traceId,
                UUID credentialId,
                List<com.freelanceops.backend.domain.agentrun.dto.PetProfile> petProfiles) {
            this(
                    provider,
                    model,
                    promptVersion,
                    toolSchemaVersion,
                    traceId,
                    credentialId,
                    petProfiles,
                    null,
                    List.of(),
                    List.of());
        }

        public AgentRunMetadata {
            resolvedSkillIds = resolvedSkillIds == null ? List.of() : List.copyOf(resolvedSkillIds);
            deferredSkillIds = deferredSkillIds == null ? List.of() : List.copyOf(deferredSkillIds);
        }

        public AgentRunMetadata(
                Provider provider,
                String model,
                String promptVersion,
                String toolSchemaVersion,
                String traceId,
                UUID credentialId) {
            this(
                    provider,
                    model,
                    promptVersion,
                    toolSchemaVersion,
                    traceId,
                    credentialId,
                    List.of());
        }

        public AgentRunMetadata(
                Provider provider,
                String model,
                String promptVersion,
                String toolSchemaVersion,
                String traceId) {
            this(provider, model, promptVersion, toolSchemaVersion, traceId, null);
        }
    }

    public record ExternalToolCallUsage(UUID callId, String provider, String operation, String tariffVersion,
            int credits, java.math.BigDecimal reservedCostUsd, java.math.BigDecimal costUsd, boolean usageKnown) {}

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
            long durationMs,
            List<ProviderCallUsage> providerCalls,
            java.math.BigDecimal platformCostUsd,
            UUID platformReservationId,
            String tariffVersion,
            Boolean executionClosed,
            Boolean unpricedExposure,
            UUID byokScopeId,
            List<ExternalToolCallUsage> externalToolCalls) {
        public AgentRunUsage(RequestTier requestTier, long modelCalls, long toolCalls, long inputTokens,
                long outputTokens, long cachedTokens, long searchCredits, long crawledPages, long retryCount,
                long durationMs, List<ProviderCallUsage> providerCalls, java.math.BigDecimal platformCostUsd,
                UUID platformReservationId, String tariffVersion, Boolean executionClosed, Boolean unpricedExposure,
                UUID byokScopeId) {
            this(requestTier, modelCalls, toolCalls, inputTokens, outputTokens, cachedTokens, searchCredits,
                    crawledPages, retryCount, durationMs, providerCalls, platformCostUsd, platformReservationId,
                    tariffVersion, executionClosed, unpricedExposure, byokScopeId, List.of());
        }
        public AgentRunUsage(
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
                List<ProviderCallUsage> providerCalls,
                java.math.BigDecimal platformCostUsd,
                UUID platformReservationId,
                String tariffVersion,
                Boolean executionClosed,
                Boolean unpricedExposure) {
            this(
                    requestTier,
                    modelCalls,
                    toolCalls,
                    inputTokens,
                    outputTokens,
                    cachedTokens,
                    searchCredits,
                    crawledPages,
                    retryCount,
                    durationMs,
                    providerCalls,
                    platformCostUsd,
                    platformReservationId,
                    tariffVersion,
                    executionClosed,
                    unpricedExposure,
                    null);
        }

        public AgentRunUsage(
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
                List<ProviderCallUsage> providerCalls,
                java.math.BigDecimal platformCostUsd,
                UUID platformReservationId,
                String tariffVersion,
                boolean executionClosed) {
            this(
                    requestTier,
                    modelCalls,
                    toolCalls,
                    inputTokens,
                    outputTokens,
                    cachedTokens,
                    searchCredits,
                    crawledPages,
                    retryCount,
                    durationMs,
                    providerCalls,
                    platformCostUsd,
                    platformReservationId,
                    tariffVersion,
                    executionClosed,
                    false);
        }

        public AgentRunUsage(
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
                List<ProviderCallUsage> providerCalls,
                java.math.BigDecimal platformCostUsd,
                UUID platformReservationId,
                String tariffVersion) {
            this(
                    requestTier,
                    modelCalls,
                    toolCalls,
                    inputTokens,
                    outputTokens,
                    cachedTokens,
                    searchCredits,
                    crawledPages,
                    retryCount,
                    durationMs,
                    providerCalls,
                    platformCostUsd,
                    platformReservationId,
                    tariffVersion,
                    false);
        }

        public AgentRunUsage(
                RequestTier requestTier,
                long modelCalls,
                long toolCalls,
                long inputTokens,
                long outputTokens,
                long cachedTokens,
                long searchCredits,
                long crawledPages,
                long retryCount,
                long durationMs) {
            this(
                    requestTier,
                    modelCalls,
                    toolCalls,
                    inputTokens,
                    outputTokens,
                    cachedTokens,
                    searchCredits,
                    crawledPages,
                    retryCount,
                    durationMs,
                    List.of(),
                    null,
                    null,
                    null);
        }

        public AgentRunUsage {
            if (byokScopeId != null && (platformReservationId != null || tariffVersion != null))
                throw new IllegalArgumentException("Personal usage cannot claim platform funding");
            // 기존 Agent 스냅샷에는 이 필드가 없다. 종료 정보가 없으면 예약 금액을 반환하지 않는다.
            executionClosed = Boolean.TRUE.equals(executionClosed);
            unpricedExposure = Boolean.TRUE.equals(unpricedExposure);
            providerCalls = providerCalls == null ? List.of() : List.copyOf(providerCalls);
            externalToolCalls = externalToolCalls == null ? List.of() : List.copyOf(externalToolCalls);
            var attemptIds = new java.util.HashSet<UUID>();
            for (var call : providerCalls) attemptIds.add(call.callId());
            for (var call : externalToolCalls) {
                if (call.callId() == null || !attemptIds.add(call.callId()))
                    throw new IllegalArgumentException("Duplicate external attempt identity");
            }
            if (byokScopeId != null && !externalToolCalls.isEmpty())
                throw new IllegalArgumentException("Personal execution cannot use paid external tools");
            if ((platformReservationId == null) != (tariffVersion == null)) {
                throw new IllegalArgumentException("Platform usage provenance must be complete");
            }
            if (platformCostUsd != null && platformCostUsd.signum() < 0)
                throw new IllegalArgumentException("Negative platform cost");
            if (providerCalls.stream().map(ProviderCallUsage::callId).distinct().count()
                    != providerCalls.size()) {
                throw new IllegalArgumentException("Duplicate provider attempt identity");
            }
            if (requestTier == null
                    || modelCalls < 0
                    || toolCalls < 0
                    || inputTokens < 0
                    || outputTokens < 0
                    || cachedTokens < 0
                    || searchCredits < 0
                    || crawledPages < 0
                    || retryCount < 0
                    || durationMs < 0) {
                throw new IllegalArgumentException("Agent run usage values must not be negative");
            }
            if (cachedTokens > inputTokens)
                throw new IllegalArgumentException("cached tokens exceed input tokens");
        }
    }

    public record ProviderCallUsage(
            UUID callId,
            Provider provider,
            String model,
            String operation,
            long inputTokens,
            long outputTokens,
            long cachedReadTokens,
            long cacheWriteTokens,
            java.math.BigDecimal costUsd,
            java.math.BigDecimal reservedCostUsd,
            boolean usageKnown,
            String fundingSource) {
        public ProviderCallUsage(
                UUID callId,
                Provider provider,
                String model,
                String operation,
                long inputTokens,
                long outputTokens,
                long cachedReadTokens,
                long cacheWriteTokens,
                java.math.BigDecimal costUsd,
                java.math.BigDecimal reservedCostUsd,
                boolean usageKnown) {
            this(
                    callId,
                    provider,
                    model,
                    operation,
                    inputTokens,
                    outputTokens,
                    cachedReadTokens,
                    cacheWriteTokens,
                    costUsd,
                    reservedCostUsd,
                    usageKnown,
                    "PLATFORM");
        }

        public ProviderCallUsage {
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
}
