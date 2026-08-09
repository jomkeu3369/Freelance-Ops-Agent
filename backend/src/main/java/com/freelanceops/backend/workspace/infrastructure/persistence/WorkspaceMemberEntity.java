package com.freelanceops.backend.workspace.infrastructure.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

@Entity
@Table(name = "workspace_member", schema = "app")
public class WorkspaceMemberEntity {

    @Id
    private UUID id;

    @Column(name = "workspace_id")
    private UUID workspaceId;

    @Column(name = "user_id")
    private UUID userId;

    private String status;

    @Column(name = "joined_at")
    private OffsetDateTime joinedAt;

    protected WorkspaceMemberEntity() {
    }

    private WorkspaceMemberEntity(UUID id, UUID workspaceId, UUID userId) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.userId = userId;
        this.status = "ACTIVE";
        this.joinedAt = OffsetDateTime.now(ZoneOffset.UTC);
    }

    public static WorkspaceMemberEntity activeOwner(UUID id, UUID workspaceId, UUID userId) {
        return new WorkspaceMemberEntity(id, workspaceId, userId);
    }

    public UUID id() {
        return id;
    }
}
