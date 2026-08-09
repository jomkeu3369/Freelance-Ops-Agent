package com.freelanceops.backend.workspace.domain;

import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;

public class RoleAssignmentPolicy {

    public void validate(SystemRole actorRole, UUID actorMembershipId, UUID targetMembershipId,
                         Set<SystemRole> currentRoles, Set<SystemRole> requestedRoles, long activeOwnerCount) {
        if (currentRoles.contains(SystemRole.OWNER)
            && !requestedRoles.contains(SystemRole.OWNER)
            && activeOwnerCount <= 1) {
            throw new RbacInvariantViolationException(
                "LAST_OWNER_REQUIRED",
                "The last active OWNER cannot lose the OWNER role"
            );
        }

        if (actorRole == SystemRole.ADMIN && ownerRoleChanged(currentRoles, requestedRoles)) {
            throw new RbacInvariantViolationException(
                "ADMIN_CANNOT_CHANGE_OWNER",
                "ADMIN cannot grant or revoke the OWNER role"
            );
        }

        if (actorMembershipId.equals(targetMembershipId)
            && !effectivePermissions(currentRoles).containsAll(effectivePermissions(requestedRoles))) {
            throw new RbacInvariantViolationException(
                "SELF_PRIVILEGE_ESCALATION",
                "A member cannot increase their own effective permissions"
            );
        }
    }

    private boolean ownerRoleChanged(Set<SystemRole> currentRoles, Set<SystemRole> requestedRoles) {
        return currentRoles.contains(SystemRole.OWNER) != requestedRoles.contains(SystemRole.OWNER);
    }

    private Set<PermissionCode> effectivePermissions(Set<SystemRole> roles) {
        EnumSet<PermissionCode> permissions = EnumSet.noneOf(PermissionCode.class);
        roles.forEach(role -> permissions.addAll(role.permissions()));
        return permissions;
    }
}
