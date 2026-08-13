package com.freelanceops.backend.domain.quotation.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "quotation", schema = "app")
public class QuotationEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "project_id", nullable = false) private UUID projectId;
    @Column(name = "series_id", nullable = false) private UUID seriesId;
    @Column(name = "previous_version_id") private UUID previousVersionId;
    @Column(name = "version_number", nullable = false) private int versionNumber;
    @Column(nullable = false, length = 20) private String scenario;
    @Column(nullable = false, length = 20) private String status;
    @Column(nullable = false, length = 3) private String currency;
    @Column(nullable = false, precision = 19, scale = 2) private BigDecimal subtotal;
    @Column(name = "discount_total", nullable = false, precision = 19, scale = 2) private BigDecimal discountTotal;
    @Column(name = "risk_buffer_rate", nullable = false, precision = 7, scale = 6) private BigDecimal riskBufferRate;
    @Column(name = "risk_buffer_amount", nullable = false, precision = 19, scale = 2) private BigDecimal riskBufferAmount;
    @Column(name = "tax_rate", nullable = false, precision = 7, scale = 6) private BigDecimal taxRate;
    @Column(name = "tax_amount", nullable = false, precision = 19, scale = 2) private BigDecimal taxAmount;
    @Column(nullable = false, precision = 19, scale = 2) private BigDecimal total;
    @Column(name = "valid_until") private LocalDate validUntil;
    @Column(name = "published_at") private Instant publishedAt;
    @Column(name = "published_by") private UUID publishedBy;
    @Column(name = "created_by", nullable = false) private UUID createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private long version;

    protected QuotationEntity() {
    }

    public QuotationEntity(UUID id, UUID workspaceId, UUID projectId, UUID seriesId, UUID previousVersionId, int versionNumber, String scenario, String currency, BigDecimal subtotal, BigDecimal discountTotal, BigDecimal riskBufferRate, BigDecimal riskBufferAmount, BigDecimal taxRate, BigDecimal taxAmount, BigDecimal total, LocalDate validUntil, UUID createdBy, Instant now) {
        this.id = id; this.workspaceId = workspaceId; this.projectId = projectId; this.seriesId = seriesId;
        this.previousVersionId = previousVersionId; this.versionNumber = versionNumber; this.scenario = scenario;
        this.status = "DRAFT"; this.currency = currency; this.subtotal = subtotal; this.discountTotal = discountTotal;
        this.riskBufferRate = riskBufferRate; this.riskBufferAmount = riskBufferAmount;
        this.taxRate = taxRate; this.taxAmount = taxAmount; this.total = total; this.validUntil = validUntil;
        this.createdBy = createdBy; this.createdAt = now; this.updatedAt = now;
    }

    public void publish(UUID userId, Instant now) {
        if (!"DRAFT".equals(status)) throw new IllegalStateException("only a draft quotation can be published");
        status = "PUBLISHED"; publishedBy = userId; publishedAt = now; updatedAt = now;
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID projectId() { return projectId; }
    public UUID seriesId() { return seriesId; }
    public UUID previousVersionId() { return previousVersionId; }
    public int versionNumber() { return versionNumber; }
    public String scenario() { return scenario; }
    public String status() { return status; }
    public String currency() { return currency; }
    public BigDecimal subtotal() { return subtotal; }
    public BigDecimal discountTotal() { return discountTotal; }
    public BigDecimal riskBufferRate() { return riskBufferRate; }
    public BigDecimal riskBufferAmount() { return riskBufferAmount; }
    public BigDecimal taxRate() { return taxRate; }
    public BigDecimal taxAmount() { return taxAmount; }
    public BigDecimal total() { return total; }
    public LocalDate validUntil() { return validUntil; }
    public Instant publishedAt() { return publishedAt; }
    public UUID createdBy() { return createdBy; }
    public Instant createdAt() { return createdAt; }
    public long version() { return version; }
}
