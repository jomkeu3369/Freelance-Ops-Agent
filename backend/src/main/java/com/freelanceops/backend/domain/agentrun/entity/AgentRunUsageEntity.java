package com.freelanceops.backend.domain.agentrun.entity;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.AgentRunUsage;
import com.freelanceops.backend.domain.agentrun.model.CostStatus;
import com.freelanceops.backend.domain.agentrun.model.RequestTier;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "agent_run_usage", schema = "app")
public class AgentRunUsageEntity {
    @Id @Column(name = "agent_run_id") private UUID agentRunId;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "pricing_snapshot_id") private UUID pricingSnapshotId;
    @Enumerated(EnumType.STRING) @Column(name = "request_tier", nullable = false, length = 30) private RequestTier requestTier;
    @Column(name = "model_calls", nullable = false) private long modelCalls;
    @Column(name = "tool_calls", nullable = false) private long toolCalls;
    @Column(name = "input_tokens", nullable = false) private long inputTokens;
    @Column(name = "output_tokens", nullable = false) private long outputTokens;
    @Column(name = "cached_tokens", nullable = false) private long cachedTokens;
    @Column(name = "search_credits", nullable = false) private long searchCredits;
    @Column(name = "crawled_pages", nullable = false) private long crawledPages;
    @Column(name = "retry_count", nullable = false) private long retryCount;
    @Column(name = "duration_ms", nullable = false) private long durationMs;
    @Column(name = "actual_cost", precision = 19, scale = 8) private BigDecimal actualCost;
    @JdbcTypeCode(SqlTypes.CHAR) @Column(name = "cost_currency", length = 3) private String costCurrency;
    @Enumerated(EnumType.STRING) @Column(name = "cost_status", nullable = false, length = 20) private CostStatus costStatus;
    @Column(name = "billable_outcome", nullable = false) private boolean billableOutcome;
    @Column(name = "recorded_at", nullable = false) private Instant recordedAt;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name = "provider_calls", nullable = false, columnDefinition = "jsonb")
    private java.util.List<com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage> providerCalls = java.util.List.of();
    @Column(name = "platform_cost_usd", precision = 19, scale = 8) private BigDecimal platformCostUsd;
    @Column(name = "platform_reservation_id") private UUID platformReservationId;
    @Column(name = "tariff_version", length = 100) private String tariffVersion;
    @Column(name = "byok_scope_id") private UUID byokScopeId;
    @Version private long version;

    protected AgentRunUsageEntity() { }

    public AgentRunUsageEntity(UUID agentRunId, UUID workspaceId) {
        this.agentRunId = agentRunId; this.workspaceId = workspaceId;
    }

    public void update(AgentRunUsage usage, ModelPricingEntity pricing, BigDecimal actualCost, boolean billableOutcome, Instant recordedAt) {
        if (usage.cachedTokens() > usage.inputTokens()) throw new IllegalArgumentException("cached tokens exceed input tokens");
        this.requestTier = usage.requestTier(); this.modelCalls = usage.modelCalls(); this.toolCalls = usage.toolCalls();
        this.inputTokens = usage.inputTokens(); this.outputTokens = usage.outputTokens(); this.cachedTokens = usage.cachedTokens();
        this.searchCredits = usage.searchCredits(); this.crawledPages = usage.crawledPages(); this.retryCount = usage.retryCount();
        this.durationMs = usage.durationMs(); this.billableOutcome = billableOutcome; this.recordedAt = recordedAt;
        this.pricingSnapshotId = pricing == null ? null : pricing.id(); this.actualCost = actualCost;
        this.costCurrency = pricing == null ? null : pricing.currency(); this.costStatus = pricing == null ? CostStatus.UNPRICED : CostStatus.PRICED;
    }

    public void updatePlatform(AgentRunUsage usage, BigDecimal actualCost, BigDecimal conservativeCost,
                               boolean billableOutcome, Instant recordedAt) {
        update(usage, null, actualCost, billableOutcome, recordedAt);
        this.providerCalls = java.util.List.copyOf(usage.providerCalls());
        this.platformCostUsd = conservativeCost;
        this.platformReservationId = usage.platformReservationId();
        this.tariffVersion = usage.tariffVersion();
        this.byokScopeId = usage.byokScopeId();
        this.costCurrency = usage.platformReservationId() == null ? null : "USD";
        this.costStatus = actualCost == null ? CostStatus.UNPRICED : CostStatus.PRICED;
    }

    public void updateByok(AgentRunUsage usage, boolean billableOutcome, Instant recordedAt) {
        update(usage, null, null, billableOutcome, recordedAt);
        this.providerCalls = java.util.List.copyOf(usage.providerCalls());
        this.byokScopeId = usage.byokScopeId();
        this.platformCostUsd = BigDecimal.ZERO;
        this.platformReservationId = null;
        this.tariffVersion = null;
    }
    public UUID byokScopeId() { return byokScopeId; }

    public java.util.List<com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage> providerCalls() { return providerCalls; }
    public BigDecimal platformCostUsd() { return platformCostUsd; }
    public UUID platformReservationId() { return platformReservationId; }
    public String tariffVersion() { return tariffVersion; }
    public UUID agentRunId() { return agentRunId; }
    public UUID workspaceId() { return workspaceId; }
    public UUID pricingSnapshotId() { return pricingSnapshotId; }
    public RequestTier requestTier() { return requestTier; }
    public long modelCalls() { return modelCalls; }
    public long toolCalls() { return toolCalls; }
    public long inputTokens() { return inputTokens; }
    public long outputTokens() { return outputTokens; }
    public long cachedTokens() { return cachedTokens; }
    public long searchCredits() { return searchCredits; }
    public long crawledPages() { return crawledPages; }
    public long retryCount() { return retryCount; }
    public long durationMs() { return durationMs; }
    public BigDecimal actualCost() { return actualCost; }
    public String costCurrency() { return costCurrency; }
    public CostStatus costStatus() { return costStatus; }
    public boolean billableOutcome() { return billableOutcome; }
    public Instant recordedAt() { return recordedAt; }
}
