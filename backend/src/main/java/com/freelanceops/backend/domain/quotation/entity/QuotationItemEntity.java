package com.freelanceops.backend.domain.quotation.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "quotation_item", schema = "app")
public class QuotationItemEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "quotation_id", nullable = false) private UUID quotationId;
    @Column(name = "rate_card_id") private UUID rateCardId;
    @Column(nullable = false, length = 200) private String title;
    @Column(length = 5000) private String description;
    @Column(nullable = false, precision = 19, scale = 4) private BigDecimal quantity;
    @Column(nullable = false, length = 20) private String unit;
    @Column(name = "unit_rate", nullable = false, precision = 19, scale = 2) private BigDecimal unitRate;
    @Column(nullable = false, precision = 19, scale = 2) private BigDecimal subtotal;
    @Column(name = "discount_rate", nullable = false, precision = 7, scale = 6) private BigDecimal discountRate;
    @Column(name = "discount_amount", nullable = false, precision = 19, scale = 2) private BigDecimal discountAmount;
    @Column(nullable = false, precision = 19, scale = 2) private BigDecimal total;
    @Column(name = "assumption_id") private UUID assumptionId;
    @Column(name = "evidence_id") private UUID evidenceId;
    @Column(name = "sort_order", nullable = false) private int sortOrder;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected QuotationItemEntity() {
    }

    public QuotationItemEntity(UUID id, UUID workspaceId, UUID quotationId, UUID rateCardId, String title, String description, BigDecimal quantity, String unit, BigDecimal unitRate, BigDecimal subtotal, BigDecimal discountRate, BigDecimal discountAmount, BigDecimal total, UUID assumptionId, UUID evidenceId, int sortOrder, Instant createdAt) {
        if ((assumptionId == null) == (evidenceId == null)) throw new IllegalArgumentException("exactly one evidence or assumption is required");
        this.id = id; this.workspaceId = workspaceId; this.quotationId = quotationId; this.rateCardId = rateCardId;
        this.title = title; this.description = description; this.quantity = quantity; this.unit = unit;
        this.unitRate = unitRate; this.subtotal = subtotal; this.discountRate = discountRate;
        this.discountAmount = discountAmount; this.total = total; this.assumptionId = assumptionId;
        this.evidenceId = evidenceId; this.sortOrder = sortOrder; this.createdAt = createdAt;
    }

    public UUID rateCardId() { return rateCardId; }
    public UUID quotationId() { return quotationId; }
    public String title() { return title; }
    public String description() { return description; }
    public BigDecimal quantity() { return quantity; }
    public String unit() { return unit; }
    public BigDecimal unitRate() { return unitRate; }
    public BigDecimal subtotal() { return subtotal; }
    public BigDecimal discountRate() { return discountRate; }
    public BigDecimal discountAmount() { return discountAmount; }
    public BigDecimal total() { return total; }
    public UUID assumptionId() { return assumptionId; }
    public UUID evidenceId() { return evidenceId; }
}
