package com.freelanceops.backend.domain.quotation.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "estimation_policy", schema = "app")
public class EstimationPolicyEntity {
    @Id @Column(name = "workspace_id") private UUID workspaceId;
    @Column(name = "default_tax_rate", nullable = false, precision = 7, scale = 6) private BigDecimal defaultTaxRate;
    @Column(name = "default_risk_buffer_rate", nullable = false, precision = 7, scale = 6) private BigDecimal defaultRiskBufferRate;
    @Column(name = "maximum_discount_rate", nullable = false, precision = 7, scale = 6) private BigDecimal maximumDiscountRate;
    @Column(name = "created_by", nullable = false) private UUID createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private long version;

    protected EstimationPolicyEntity() {
    }

    public EstimationPolicyEntity(UUID workspaceId, BigDecimal defaultTaxRate, BigDecimal defaultRiskBufferRate, BigDecimal maximumDiscountRate, UUID createdBy, Instant now) {
        this.workspaceId = workspaceId; this.defaultTaxRate = defaultTaxRate;
        this.defaultRiskBufferRate = defaultRiskBufferRate; this.maximumDiscountRate = maximumDiscountRate;
        this.createdBy = createdBy; this.createdAt = now; this.updatedAt = now;
    }

    public void update(BigDecimal defaultTaxRate, BigDecimal defaultRiskBufferRate, BigDecimal maximumDiscountRate, Instant now) {
        this.defaultTaxRate = defaultTaxRate; this.defaultRiskBufferRate = defaultRiskBufferRate;
        this.maximumDiscountRate = maximumDiscountRate; this.updatedAt = now;
    }

    public UUID workspaceId() { return workspaceId; }
    public BigDecimal defaultTaxRate() { return defaultTaxRate; }
    public BigDecimal defaultRiskBufferRate() { return defaultRiskBufferRate; }
    public BigDecimal maximumDiscountRate() { return maximumDiscountRate; }
    public long version() { return version; }
}
