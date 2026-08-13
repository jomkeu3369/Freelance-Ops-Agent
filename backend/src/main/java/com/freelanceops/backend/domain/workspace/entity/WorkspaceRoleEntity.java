package com.freelanceops.backend.domain.workspace.entity;

import com.freelanceops.backend.domain.workspace.policy.SystemRole;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.util.UUID;

@Entity
@Table(name = "workspace_role", schema = "app")
public class WorkspaceRoleEntity {

    @Id
    private UUID id;

    @Column(name = "workspace_id")
    private UUID workspaceId;

    private String code;

    @Column(name = "display_name")
    private String displayName;

    @Column(name = "system_role")
    private boolean systemRole;

    protected WorkspaceRoleEntity() {
    }

    private WorkspaceRoleEntity(UUID id, UUID workspaceId, SystemRole role) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.code = role.name();
        this.displayName = role.name();
        this.systemRole = true;
    }

    public static WorkspaceRoleEntity system(UUID id, UUID workspaceId, SystemRole role) {
        return new WorkspaceRoleEntity(id, workspaceId, role);
    }
}


