package com.freelanceops.backend.domain.quotation.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "rate_card", schema = "app")
public class RateCardEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(nullable = false, length = 120) private String name;
    @Column(nullable = false, length = 20) private String unit;
    @Column(nullable = false, precision = 19, scale = 2) private BigDecimal rate;
    @Column(name = "minimum_amount", nullable = false, precision = 19, scale = 2) private BigDecimal minimumAmount;
    @Column(nullable = false, length = 3) private String currency;
    @Column(nullable = false) private boolean active;
    @Column(name = "created_by", nullable = false) private UUID createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private long version;

    protected RateCardEntity() {
    }

    public RateCardEntity(UUID id, UUID workspaceId, String name, String unit, BigDecimal rate, BigDecimal minimumAmount, String currency, UUID createdBy, Instant now) {
        this.id = id; this.workspaceId = workspaceId; this.name = name; this.unit = unit;
        this.rate = rate; this.minimumAmount = minimumAmount; this.currency = currency; this.active = true;
        this.createdBy = createdBy; this.createdAt = now; this.updatedAt = now;
    }

    public void update(String name, String unit, BigDecimal rate, BigDecimal minimumAmount, String currency, boolean active, Instant now) {
        this.name = name; this.unit = unit; this.rate = rate; this.minimumAmount = minimumAmount;
        this.currency = currency; this.active = active; this.updatedAt = now;
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public String name() { return name; }
    public String unit() { return unit; }
    public BigDecimal rate() { return rate; }
    public BigDecimal minimumAmount() { return minimumAmount; }
    public String currency() { return currency; }
    public boolean active() { return active; }
    public long version() { return version; }
}
