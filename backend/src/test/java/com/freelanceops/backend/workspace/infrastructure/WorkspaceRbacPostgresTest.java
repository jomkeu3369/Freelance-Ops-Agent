package com.freelanceops.backend.workspace.infrastructure;

import com.freelanceops.backend.workspace.application.AuthorizationAuditSink;
import com.freelanceops.backend.workspace.application.WorkspaceProvisioningResult;
import com.freelanceops.backend.workspace.application.WorkspaceProvisioningService;
import com.freelanceops.backend.workspace.application.WorkspaceAuthorizationService;
import com.freelanceops.backend.workspace.application.WorkspacePermissionReader;
import com.freelanceops.backend.workspace.domain.AuthorizationDecision;
import com.freelanceops.backend.workspace.domain.PermissionCode;
import com.freelanceops.backend.workspace.domain.SystemRole;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest
class WorkspaceRbacPostgresTest {

    @Container
    private static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17-alpine");

    @Autowired
    private JdbcClient jdbcClient;

    @Autowired
    private WorkspaceProvisioningService provisioningService;

    @Autowired
    private WorkspacePermissionReader permissionReader;

    @Autowired
    private AuthorizationAuditSink auditSink;

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.flyway.create-schemas", () -> true);
    }

    @Test
    void migrationSeedsStablePermissionCatalog() {
        Integer count = jdbcClient.sql("SELECT COUNT(*) FROM app.permission")
            .query(Integer.class)
            .single();

        assertThat(count).isEqualTo(PermissionCode.values().length);
    }

    @Test
    void provisioningCreatesRolesAndAssignsOwnerWithAllPermissions() {
        UUID creatorId = insertUser("owner-one");

        WorkspaceProvisioningResult result = provisioningService.create(
            creatorId,
            "Owner Workspace",
            "owner-workspace"
        );

        Integer roleCount = jdbcClient.sql("SELECT COUNT(*) FROM app.workspace_role WHERE workspace_id = :workspaceId")
            .param("workspaceId", result.workspaceId())
            .query(Integer.class)
            .single();
        assertThat(roleCount).isEqualTo(SystemRole.values().length);
        assertThat(permissionReader.findActiveMembership(creatorId, result.workspaceId()))
            .get()
            .extracting(membership -> membership.permissions().size())
            .isEqualTo(PermissionCode.values().length);
    }

    @Test
    void databaseRejectsRoleAssignmentAcrossWorkspaces() {
        UUID creatorId = insertUser("owner-two");
        WorkspaceProvisioningResult first = provisioningService.create(creatorId, "First", "first-workspace");
        WorkspaceProvisioningResult second = provisioningService.create(creatorId, "Second", "second-workspace");
        UUID secondRoleId = jdbcClient.sql("""
                SELECT id FROM app.workspace_role
                WHERE workspace_id = :workspaceId AND code = 'VIEWER'
                """)
            .param("workspaceId", second.workspaceId())
            .query(UUID.class)
            .single();

        assertThatThrownBy(() -> jdbcClient.sql("""
                INSERT INTO app.member_role (workspace_id, membership_id, role_id, assigned_by)
                VALUES (:workspaceId, :membershipId, :roleId, :assignedBy)
                """)
            .param("workspaceId", first.workspaceId())
            .param("membershipId", first.ownerMembershipId())
            .param("roleId", secondRoleId)
            .param("assignedBy", creatorId)
            .update())
            .isInstanceOf(DataAccessException.class);
    }

    @Test
    void deniedAccessIsWrittenToAuditLog() {
        UUID ownerId = insertUser("owner-three");
        UUID intruderId = insertUser("intruder-three");
        WorkspaceProvisioningResult workspace = provisioningService.create(
            ownerId,
            "Audited Workspace",
            "audited-workspace"
        );
        WorkspaceAuthorizationService authorizationService = new WorkspaceAuthorizationService(
            permissionReader,
            auditSink
        );

        AuthorizationDecision decision = authorizationService.authorize(
            intruderId,
            workspace.workspaceId(),
            PermissionCode.WORKSPACE_READ
        );
        Integer deniedCount = jdbcClient.sql("""
                SELECT COUNT(*) FROM app.rbac_audit_event
                WHERE actor_user_id = :actorUserId
                  AND action = 'AUTHORIZATION_CHECK'
                  AND outcome = 'NOT_FOUND'
                """)
            .param("actorUserId", intruderId)
            .query(Integer.class)
            .single();

        assertThat(decision).isEqualTo(AuthorizationDecision.NOT_FOUND);
        assertThat(deniedCount).isEqualTo(1);
    }

    private UUID insertUser(String subject) {
        UUID userId = UUID.randomUUID();
        jdbcClient.sql("""
                INSERT INTO app.user_account (id, external_subject, email, status)
                VALUES (:id, :subject, :email, 'ACTIVE')
                """)
            .param("id", userId)
            .param("subject", subject)
            .param("email", subject + "@example.com")
            .update();
        return userId;
    }
}
