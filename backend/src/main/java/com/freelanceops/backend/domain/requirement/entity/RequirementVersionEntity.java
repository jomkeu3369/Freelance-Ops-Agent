package com.freelanceops.backend.domain.requirement.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "requirement_version", schema = "app")
public class RequirementVersionEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "project_id", nullable = false) private UUID projectId;
    @Column(name = "version_number", nullable = false) private int versionNumber;
    @Column(name = "source_text", nullable = false, length = 50000) private String sourceText;
    @Column(name = "created_by", nullable = false) private UUID createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private long version;

    protected RequirementVersionEntity() {
    }

    public RequirementVersionEntity(UUID id, UUID workspaceId, UUID projectId, int versionNumber, String sourceText, UUID createdBy, Instant now) {
        this.id = id; this.workspaceId = workspaceId; this.projectId = projectId;
        this.versionNumber = versionNumber; this.sourceText = sourceText; this.createdBy = createdBy;
        this.createdAt = now; this.updatedAt = now;
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID projectId() { return projectId; }
    public int versionNumber() { return versionNumber; }
    public String sourceText() { return sourceText; }
    public UUID createdBy() { return createdBy; }
    public Instant createdAt() { return createdAt; }
}
