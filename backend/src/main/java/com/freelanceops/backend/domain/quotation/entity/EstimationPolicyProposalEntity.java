package com.freelanceops.backend.domain.quotation.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Immutable before/after values make a confirmation apply exactly the reviewed change. */
@Entity
@Table(name = "estimation_policy_proposal", schema = "app")
public class EstimationPolicyProposalEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "project_id", nullable = false) private UUID projectId;
    @Column(name = "source_message", nullable = false, length = 50000) private String sourceMessage;
    @Column(name = "created_by", nullable = false) private UUID createdBy;
    @Column(name = "idempotency_key", nullable = false) private UUID idempotencyKey;
    @Column(name = "confirmation_token", nullable = false) private UUID confirmationToken;
    @Column(name = "base_version", nullable = false) private long baseVersion;
    @Column(name = "before_tax_rate", nullable = false, precision = 7, scale = 6) private BigDecimal beforeTaxRate;
    @Column(name = "before_risk_buffer_rate", nullable = false, precision = 7, scale = 6) private BigDecimal beforeRiskBufferRate;
    @Column(name = "before_maximum_discount_rate", nullable = false, precision = 7, scale = 6) private BigDecimal beforeMaximumDiscountRate;
    @Column(name = "proposed_tax_rate", nullable = false, precision = 7, scale = 6) private BigDecimal proposedTaxRate;
    @Column(name = "proposed_risk_buffer_rate", nullable = false, precision = 7, scale = 6) private BigDecimal proposedRiskBufferRate;
    @Column(name = "proposed_maximum_discount_rate", nullable = false, precision = 7, scale = 6) private BigDecimal proposedMaximumDiscountRate;
    @Column(nullable = false, length = 16) private String status;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "expires_at", nullable = false) private Instant expiresAt;
    @Column(name = "applied_at") private Instant appliedAt;
    @Column(name = "applied_policy_version") private Long appliedPolicyVersion;

    protected EstimationPolicyProposalEntity() {
    }

    public EstimationPolicyProposalEntity(UUID id, UUID workspaceId, UUID projectId, String sourceMessage,
        UUID createdBy, UUID idempotencyKey,
        UUID confirmationToken, long baseVersion, BigDecimal beforeTaxRate, BigDecimal beforeRiskBufferRate,
        BigDecimal beforeMaximumDiscountRate, BigDecimal proposedTaxRate, BigDecimal proposedRiskBufferRate,
        BigDecimal proposedMaximumDiscountRate, Instant createdAt, Instant expiresAt) {
        this.id = id; this.workspaceId = workspaceId; this.projectId = projectId;
        this.sourceMessage = sourceMessage; this.createdBy = createdBy;
        this.idempotencyKey = idempotencyKey; this.confirmationToken = confirmationToken;
        this.baseVersion = baseVersion;
        this.beforeTaxRate = beforeTaxRate; this.beforeRiskBufferRate = beforeRiskBufferRate;
        this.beforeMaximumDiscountRate = beforeMaximumDiscountRate;
        this.proposedTaxRate = proposedTaxRate; this.proposedRiskBufferRate = proposedRiskBufferRate;
        this.proposedMaximumDiscountRate = proposedMaximumDiscountRate;
        this.status = "PENDING"; this.createdAt = createdAt; this.expiresAt = expiresAt;
    }

    public void markApplied(Instant when, long policyVersion) {
        this.status = "APPLIED";
        this.appliedAt = when;
        this.appliedPolicyVersion = policyVersion;
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID projectId() { return projectId; }
    public String sourceMessage() { return sourceMessage; }
    public UUID createdBy() { return createdBy; }
    public UUID idempotencyKey() { return idempotencyKey; }
    public UUID confirmationToken() { return confirmationToken; }
    public long baseVersion() { return baseVersion; }
    public BigDecimal beforeTaxRate() { return beforeTaxRate; }
    public BigDecimal beforeRiskBufferRate() { return beforeRiskBufferRate; }
    public BigDecimal beforeMaximumDiscountRate() { return beforeMaximumDiscountRate; }
    public BigDecimal proposedTaxRate() { return proposedTaxRate; }
    public BigDecimal proposedRiskBufferRate() { return proposedRiskBufferRate; }
    public BigDecimal proposedMaximumDiscountRate() { return proposedMaximumDiscountRate; }
    public String status() { return status; }
    public Instant createdAt() { return createdAt; }
    public Instant expiresAt() { return expiresAt; }
    public Instant appliedAt() { return appliedAt; }
    public Long appliedPolicyVersion() { return appliedPolicyVersion; }
}
