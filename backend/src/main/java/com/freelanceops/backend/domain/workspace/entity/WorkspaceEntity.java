package com.freelanceops.backend.domain.workspace.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.util.UUID;

@Entity
@Table(name = "workspace", schema = "app")
public class WorkspaceEntity {

    @Id
    private UUID id;

    private String name;

    private String slug;

    private String status;

    @Column(name = "created_by")
    private UUID createdBy;

    protected WorkspaceEntity() {
    }

    private WorkspaceEntity(UUID id, String name, String slug, UUID createdBy) {
        this.id = id;
        this.name = name;
        this.slug = slug;
        this.status = "ACTIVE";
        this.createdBy = createdBy;
    }

    public static WorkspaceEntity active(UUID id, String name, String slug, UUID createdBy) {
        return new WorkspaceEntity(id, name, slug, createdBy);
    }

    public UUID id() {
        return id;
    }

    public String name() {
        return name;
    }

    public String slug() {
        return slug;
    }

    public String status() {
        return status;
    }
}


