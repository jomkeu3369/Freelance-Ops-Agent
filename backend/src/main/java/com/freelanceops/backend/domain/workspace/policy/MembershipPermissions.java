package com.freelanceops.backend.domain.workspace.policy;

import java.util.Set;
import java.util.UUID;

public record MembershipPermissions(UUID membershipId, Set<PermissionCode> permissions) {

    public MembershipPermissions {
        permissions = Set.copyOf(permissions);
    }
}


