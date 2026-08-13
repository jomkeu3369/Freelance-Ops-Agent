package com.freelanceops.backend.domain.quotation.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "quotation_assumption", schema = "app")
public class QuotationAssumptionEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "quotation_id", nullable = false) private UUID quotationId;
    @Column(nullable = false, length = 3000) private String content;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected QuotationAssumptionEntity() {
    }

    public QuotationAssumptionEntity(UUID id, UUID workspaceId, UUID quotationId, String content, Instant createdAt) {
        this.id = id; this.workspaceId = workspaceId; this.quotationId = quotationId;
        this.content = content; this.createdAt = createdAt;
    }

    public UUID id() { return id; }
    public String content() { return content; }
}
