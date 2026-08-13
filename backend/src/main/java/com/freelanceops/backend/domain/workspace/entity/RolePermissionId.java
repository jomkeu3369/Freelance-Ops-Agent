package com.freelanceops.backend.domain.workspace.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

@Embeddable
public class RolePermissionId implements Serializable {

    @Column(name = "role_id")
    private UUID roleId;

    @Column(name = "permission_code")
    private String permissionCode;

    protected RolePermissionId() {
    }

    public RolePermissionId(UUID roleId, String permissionCode) {
        this.roleId = roleId;
        this.permissionCode = permissionCode;
    }

    public UUID roleId() {
        return roleId;
    }

    public String permissionCode() {
        return permissionCode;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof RolePermissionId that)) {
            return false;
        }
        return Objects.equals(roleId, that.roleId) && Objects.equals(permissionCode, that.permissionCode);
    }

    @Override
    public int hashCode() {
        return Objects.hash(roleId, permissionCode);
    }
}


