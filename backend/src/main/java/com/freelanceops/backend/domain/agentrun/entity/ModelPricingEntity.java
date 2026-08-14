package com.freelanceops.backend.domain.agentrun.entity;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "model_pricing", schema = "app")
public class ModelPricingEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private Provider provider;
    @Column(nullable = false, length = 100) private String model;
    @Column(name = "version_label", nullable = false, length = 100) private String versionLabel;
    @JdbcTypeCode(SqlTypes.CHAR) @Column(nullable = false, length = 3) private String currency;
    @Column(name = "input_per_million", nullable = false, precision = 19, scale = 8) private BigDecimal inputPerMillion;
    @Column(name = "cached_input_per_million", nullable = false, precision = 19, scale = 8) private BigDecimal cachedInputPerMillion;
    @Column(name = "output_per_million", nullable = false, precision = 19, scale = 8) private BigDecimal outputPerMillion;
    @Column(name = "valid_from", nullable = false) private Instant validFrom;
    @Column(name = "valid_until") private Instant validUntil;
    @Column(name = "created_by", nullable = false) private UUID createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected ModelPricingEntity() { }

    public ModelPricingEntity(UUID id, UUID workspaceId, Provider provider, String model, String versionLabel, String currency, BigDecimal inputPerMillion, BigDecimal cachedInputPerMillion, BigDecimal outputPerMillion, Instant validFrom, Instant validUntil, UUID createdBy, Instant createdAt) {
        if (validUntil != null && !validUntil.isAfter(validFrom)) throw new IllegalArgumentException("validUntil must be after validFrom");
        this.id = id; this.workspaceId = workspaceId; this.provider = provider; this.model = model;
        this.versionLabel = versionLabel; this.currency = currency; this.inputPerMillion = inputPerMillion;
        this.cachedInputPerMillion = cachedInputPerMillion; this.outputPerMillion = outputPerMillion;
        this.validFrom = validFrom; this.validUntil = validUntil; this.createdBy = createdBy; this.createdAt = createdAt;
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public Provider provider() { return provider; }
    public String model() { return model; }
    public String versionLabel() { return versionLabel; }
    public String currency() { return currency; }
    public BigDecimal inputPerMillion() { return inputPerMillion; }
    public BigDecimal cachedInputPerMillion() { return cachedInputPerMillion; }
    public BigDecimal outputPerMillion() { return outputPerMillion; }
    public Instant validFrom() { return validFrom; }
    public Instant validUntil() { return validUntil; }
}
