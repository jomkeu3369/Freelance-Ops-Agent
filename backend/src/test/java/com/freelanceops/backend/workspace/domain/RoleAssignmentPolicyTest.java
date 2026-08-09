package com.freelanceops.backend.workspace.domain;

import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RoleAssignmentPolicyTest {

    private final RoleAssignmentPolicy policy = new RoleAssignmentPolicy();

    @Test
    void protectsLastActiveOwner() {
        assertThatThrownBy(() -> policy.validate(
            SystemRole.OWNER,
            UUID.randomUUID(),
            UUID.randomUUID(),
            Set.of(SystemRole.OWNER),
            Set.of(SystemRole.ADMIN),
            1
        ))
            .isInstanceOf(RbacInvariantViolationException.class)
            .hasMessageContaining("last active OWNER");
    }

    @Test
    void adminCannotGrantOwner() {
        assertThatThrownBy(() -> policy.validate(
            SystemRole.ADMIN,
            UUID.randomUUID(),
            UUID.randomUUID(),
            Set.of(SystemRole.MANAGER),
            Set.of(SystemRole.OWNER),
            2
        ))
            .isInstanceOf(RbacInvariantViolationException.class)
            .hasMessageContaining("ADMIN cannot");
    }

    @Test
    void blocksSelfPrivilegeEscalation() {
        UUID membershipId = UUID.randomUUID();

        assertThatThrownBy(() -> policy.validate(
            SystemRole.MANAGER,
            membershipId,
            membershipId,
            Set.of(SystemRole.VIEWER),
            Set.of(SystemRole.MANAGER),
            1
        ))
            .isInstanceOf(RbacInvariantViolationException.class)
            .hasMessageContaining("own effective permissions");
    }
}
