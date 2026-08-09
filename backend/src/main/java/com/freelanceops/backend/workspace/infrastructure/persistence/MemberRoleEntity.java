package com.freelanceops.backend.workspace.infrastructure.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.util.UUID;

@Entity
@Table(name = "member_role", schema = "app")
public class MemberRoleEntity {

    @EmbeddedId
    private MemberRoleId id;

    @Column(name = "workspace_id")
    private UUID workspaceId;

    @Column(name = "assigned_by")
    private UUID assignedBy;

    protected MemberRoleEntity() {
    }

    private MemberRoleEntity(UUID workspaceId, UUID membershipId, UUID roleId, UUID assignedBy) {
        this.id = new MemberRoleId(membershipId, roleId);
        this.workspaceId = workspaceId;
        this.assignedBy = assignedBy;
    }

    public static MemberRoleEntity assign(
        UUID workspaceId,
        UUID membershipId,
        UUID roleId,
        UUID assignedBy
    ) {
        return new MemberRoleEntity(workspaceId, membershipId, roleId, assignedBy);
    }

    public UUID roleId() {
        return id.roleId();
    }
}
