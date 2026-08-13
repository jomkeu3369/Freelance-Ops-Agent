package com.freelanceops.backend.domain.outcome.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "actual_outcome", schema = "app")
public class ActualOutcomeEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "project_id", nullable = false) private UUID projectId;
    @Column(name = "approved_quotation_id") private UUID approvedQuotationId;
    @Column(name = "total_revenue", nullable = false, precision = 19, scale = 2) private BigDecimal totalRevenue;
    @Column(name = "actual_cost", nullable = false, precision = 19, scale = 2) private BigDecimal actualCost;
    @Column(name = "actual_hours", nullable = false, precision = 19, scale = 2) private BigDecimal actualHours;
    @Column(name = "profit_amount", nullable = false, precision = 19, scale = 2) private BigDecimal profitAmount;
    @Column(name = "profit_margin", precision = 9, scale = 6) private BigDecimal profitMargin;
    @Column(name = "completed_on") private LocalDate completedOn;
    @Column(name = "change_reason", length = 5000) private String changeReason;
    @Column(name = "created_by", nullable = false) private UUID createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private long version;

    protected ActualOutcomeEntity() {
    }

    public ActualOutcomeEntity(UUID id, UUID workspaceId, UUID projectId, UUID createdBy, Instant now) {
        this.id = id; this.workspaceId = workspaceId; this.projectId = projectId; this.createdBy = createdBy;
        this.totalRevenue = BigDecimal.ZERO; this.actualCost = BigDecimal.ZERO; this.actualHours = BigDecimal.ZERO;
        this.profitAmount = BigDecimal.ZERO; this.createdAt = now; this.updatedAt = now;
    }

    public void update(UUID approvedQuotationId, BigDecimal totalRevenue, BigDecimal actualCost, BigDecimal actualHours, BigDecimal profitAmount, BigDecimal profitMargin, LocalDate completedOn, String changeReason, Instant now) {
        this.approvedQuotationId = approvedQuotationId; this.totalRevenue = totalRevenue; this.actualCost = actualCost;
        this.actualHours = actualHours; this.profitAmount = profitAmount; this.profitMargin = profitMargin;
        this.completedOn = completedOn; this.changeReason = changeReason; this.updatedAt = now;
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID projectId() { return projectId; }
    public UUID approvedQuotationId() { return approvedQuotationId; }
    public BigDecimal totalRevenue() { return totalRevenue; }
    public BigDecimal actualCost() { return actualCost; }
    public BigDecimal actualHours() { return actualHours; }
    public BigDecimal profitAmount() { return profitAmount; }
    public BigDecimal profitMargin() { return profitMargin; }
    public LocalDate completedOn() { return completedOn; }
    public String changeReason() { return changeReason; }
    public long version() { return version; }
}
