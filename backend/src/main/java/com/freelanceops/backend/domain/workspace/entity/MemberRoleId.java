package com.freelanceops.backend.domain.workspace.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

@Embeddable
public class MemberRoleId implements Serializable {

    @Column(name = "membership_id")
    private UUID membershipId;

    @Column(name = "role_id")
    private UUID roleId;

    protected MemberRoleId() {
    }

    public MemberRoleId(UUID membershipId, UUID roleId) {
        this.membershipId = membershipId;
        this.roleId = roleId;
    }

    public UUID membershipId() {
        return membershipId;
    }

    public UUID roleId() {
        return roleId;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof MemberRoleId that)) {
            return false;
        }
        return Objects.equals(membershipId, that.membershipId) && Objects.equals(roleId, that.roleId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(membershipId, roleId);
    }
}


