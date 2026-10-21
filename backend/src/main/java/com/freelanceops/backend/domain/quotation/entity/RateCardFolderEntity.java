package com.freelanceops.backend.domain.quotation.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "rate_card_folder", schema = "app")
public class RateCardFolderEntity {
    @Id private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "parent_id")
    private UUID parentId;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(name = "created_by", nullable = false)
    private UUID createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version private long version;

    protected RateCardFolderEntity() {}

    public RateCardFolderEntity(
            UUID id,
            UUID workspaceId,
            UUID parentId,
            String name,
            UUID createdBy,
            Instant now) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.parentId = parentId;
        this.name = name;
        this.createdBy = createdBy;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void update(String name, UUID parentId, Instant now) {
        this.name = name;
        this.parentId = parentId;
        this.updatedAt = now;
    }

    public UUID id() {
        return id;
    }

    public UUID workspaceId() {
        return workspaceId;
    }

    public UUID parentId() {
        return parentId;
    }

    public String name() {
        return name;
    }

    public long version() {
        return version;
    }
}
