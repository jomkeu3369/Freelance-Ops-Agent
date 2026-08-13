package com.freelanceops.backend.domain.outcome.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "actual_work_item", schema = "app")
public class ActualWorkItemEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "outcome_id", nullable = false) private UUID outcomeId;
    @Column(name = "quotation_item_id") private UUID quotationItemId;
    @Column(nullable = false, length = 200) private String title;
    @Column(name = "actual_hours", nullable = false, precision = 19, scale = 2) private BigDecimal actualHours;
    @Column(name = "actual_cost", nullable = false, precision = 19, scale = 2) private BigDecimal actualCost;
    @Column(length = 3000) private String notes;
    @Column(name = "sort_order", nullable = false) private int sortOrder;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected ActualWorkItemEntity() {
    }

    public ActualWorkItemEntity(UUID id, UUID workspaceId, UUID outcomeId, UUID quotationItemId, String title, BigDecimal actualHours, BigDecimal actualCost, String notes, int sortOrder, Instant createdAt) {
        this.id = id; this.workspaceId = workspaceId; this.outcomeId = outcomeId; this.quotationItemId = quotationItemId;
        this.title = title; this.actualHours = actualHours; this.actualCost = actualCost;
        this.notes = notes; this.sortOrder = sortOrder; this.createdAt = createdAt;
    }

    public UUID quotationItemId() { return quotationItemId; }
    public String title() { return title; }
    public BigDecimal actualHours() { return actualHours; }
    public BigDecimal actualCost() { return actualCost; }
    public String notes() { return notes; }
}
