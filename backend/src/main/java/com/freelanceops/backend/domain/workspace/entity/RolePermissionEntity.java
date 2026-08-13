package com.freelanceops.backend.domain.workspace.entity;

import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.util.UUID;

@Entity
@Table(name = "role_permission", schema = "app")
public class RolePermissionEntity {

    @EmbeddedId
    private RolePermissionId id;

    @Column(name = "workspace_id")
    private UUID workspaceId;

    protected RolePermissionEntity() {
    }

    private RolePermissionEntity(UUID workspaceId, UUID roleId, PermissionCode permission) {
        this.id = new RolePermissionId(roleId, permission.code());
        this.workspaceId = workspaceId;
    }

    public static RolePermissionEntity of(UUID workspaceId, UUID roleId, PermissionCode permission) {
        return new RolePermissionEntity(workspaceId, roleId, permission);
    }

    public String permissionCode() {
        return id.permissionCode();
    }
}


