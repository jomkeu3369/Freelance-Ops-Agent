package com.freelanceops.backend.domain.knowledge.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "document", schema = "app")
public class DocumentEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "source_type", nullable = false, length = 30) private String sourceType;
    @Column(nullable = false, length = 300) private String title;
    @Column(name = "source_uri", length = 2000) private String sourceUri;
    @Column(name = "source_version", length = 120) private String sourceVersion;
    @Column(length = 120) private String jurisdiction;
    @Column(name = "effective_from") private LocalDate effectiveFrom;
    @Column(name = "effective_until") private LocalDate effectiveUntil;
    @Column(name = "content_sha256", nullable = false, length = 64) private String contentSha256;
    @Column(nullable = false, length = 20) private String status;
    @Column(name = "created_by", nullable = false) private UUID createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private long version;

    protected DocumentEntity() {
    }

    public DocumentEntity(UUID id, UUID workspaceId, String sourceType, String title, String sourceUri, String sourceVersion, String jurisdiction, LocalDate effectiveFrom, LocalDate effectiveUntil, String contentSha256, UUID createdBy, Instant now) {
        this.id = id; this.workspaceId = workspaceId; this.sourceType = sourceType; this.title = title;
        this.sourceUri = sourceUri; this.sourceVersion = sourceVersion; this.jurisdiction = jurisdiction;
        this.effectiveFrom = effectiveFrom; this.effectiveUntil = effectiveUntil; this.contentSha256 = contentSha256;
        this.status = "ACTIVE"; this.createdBy = createdBy; this.createdAt = now; this.updatedAt = now;
    }

    public void archive(Instant now) { status = "ARCHIVED"; updatedAt = now; }
    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public String sourceType() { return sourceType; }
    public String title() { return title; }
    public String sourceUri() { return sourceUri; }
    public String sourceVersion() { return sourceVersion; }
    public String jurisdiction() { return jurisdiction; }
    public LocalDate effectiveFrom() { return effectiveFrom; }
    public LocalDate effectiveUntil() { return effectiveUntil; }
    public String contentSha256() { return contentSha256; }
    public String status() { return status; }
    public UUID createdBy() { return createdBy; }
    public Instant createdAt() { return createdAt; }
    public long version() { return version; }
}
