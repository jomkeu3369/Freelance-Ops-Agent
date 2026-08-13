package com.freelanceops.backend.domain.quotation.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "quotation_evidence", schema = "app")
public class QuotationEvidenceEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "quotation_id", nullable = false) private UUID quotationId;
    @Column(name = "source_type", nullable = false, length = 30) private String sourceType;
    @Column(name = "source_reference", nullable = false, length = 1000) private String sourceReference;
    @Column(length = 300) private String title;
    @Column(nullable = false, length = 3000) private String excerpt;
    @Column(name = "retrieved_at") private Instant retrievedAt;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected QuotationEvidenceEntity() {
    }

    public QuotationEvidenceEntity(UUID id, UUID workspaceId, UUID quotationId, String sourceType, String sourceReference, String title, String excerpt, Instant retrievedAt, Instant createdAt) {
        this.id = id; this.workspaceId = workspaceId; this.quotationId = quotationId; this.sourceType = sourceType;
        this.sourceReference = sourceReference; this.title = title; this.excerpt = excerpt;
        this.retrievedAt = retrievedAt; this.createdAt = createdAt;
    }

    public UUID id() { return id; }
    public String sourceType() { return sourceType; }
    public String sourceReference() { return sourceReference; }
    public String title() { return title; }
    public String excerpt() { return excerpt; }
    public Instant retrievedAt() { return retrievedAt; }
}
