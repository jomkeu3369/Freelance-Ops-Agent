package com.freelanceops.backend.workspace.application;

import com.freelanceops.backend.workspace.domain.AuthorizationDecision;
import com.freelanceops.backend.workspace.domain.MembershipPermissions;
import com.freelanceops.backend.workspace.domain.PermissionCode;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class WorkspaceAuthorizationServiceTest {

    private final UUID userId = UUID.randomUUID();
    private final UUID workspaceId = UUID.randomUUID();
    private final List<AuthorizationAuditEvent> events = new ArrayList<>();

    @Test
    void allowsExplicitPermissionForActiveMembership() {
        WorkspaceAuthorizationService service = serviceWith(Set.of(PermissionCode.PROJECT_READ));

        AuthorizationDecision decision = service.authorize(userId, workspaceId, PermissionCode.PROJECT_READ);

        assertThat(decision).isEqualTo(AuthorizationDecision.ALLOWED);
        assertThat(events).isEmpty();
    }

    @Test
    void deniesByDefaultWhenPermissionIsMissing() {
        WorkspaceAuthorizationService service = serviceWith(Set.of(PermissionCode.PROJECT_READ));

        AuthorizationDecision decision = service.authorize(userId, workspaceId, PermissionCode.PROJECT_WRITE);

        assertThat(decision).isEqualTo(AuthorizationDecision.FORBIDDEN);
        assertThat(events).singleElement().extracting(AuthorizationAuditEvent::decision)
            .isEqualTo(AuthorizationDecision.FORBIDDEN);
    }

    @Test
    void hidesWorkspaceWhenMembershipDoesNotExist() {
        WorkspaceAuthorizationService service = new WorkspaceAuthorizationService(
            (ignoredUser, ignoredWorkspace) -> Optional.empty(),
            events::add
        );

        AuthorizationDecision decision = service.authorize(userId, workspaceId, PermissionCode.WORKSPACE_READ);

        assertThat(decision).isEqualTo(AuthorizationDecision.NOT_FOUND);
    }

    @Test
    void resourceFromAnotherWorkspaceIsHiddenBeforePermissionCheck() {
        WorkspaceAuthorizationService service = serviceWith(Set.of());

        AuthorizationDecision decision = service.authorize(
            userId,
            workspaceId,
            PermissionCode.PROJECT_READ,
            UUID.randomUUID()
        );

        assertThat(decision).isEqualTo(AuthorizationDecision.NOT_FOUND);
    }

    private WorkspaceAuthorizationService serviceWith(Set<PermissionCode> permissions) {
        MembershipPermissions membership = new MembershipPermissions(UUID.randomUUID(), permissions);
        return new WorkspaceAuthorizationService(
            (ignoredUser, ignoredWorkspace) -> Optional.of(membership),
            events::add
        );
    }
}
