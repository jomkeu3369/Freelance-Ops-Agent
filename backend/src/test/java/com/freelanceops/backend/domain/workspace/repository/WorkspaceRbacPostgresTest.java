package com.freelanceops.backend.domain.workspace.repository;

import com.freelanceops.backend.domain.workspace.repository.AuthorizationAuditSink;
import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningResult;
import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningService;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.policy.SystemRole;
import com.freelanceops.backend.domain.agentrun.service.AgentRunCommandQueue;
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
import org.testcontainers.utility.DockerImageName;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest
class WorkspaceRbacPostgresTest {

    @Container
    private static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres")
    );

    @Autowired
    private JdbcClient jdbcClient;

    @Autowired
    private WorkspaceProvisioningService provisioningService;

    @Autowired
    private WorkspacePermissionReader permissionReader;

    @Autowired
    private AuthorizationAuditSink auditSink;

    @Autowired
    private AgentRunCommandQueue agentRunCommandQueue;

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.flyway.create-schemas", () -> true);
        registry.add("agent.command-dispatch-enabled", () -> false);
        registry.add("agent.reconciliation-enabled", () -> false);
    }

    @Test
    void migrationSeedsStablePermissionCatalog() {
        Integer count = jdbcClient.sql("SELECT COUNT(*) FROM app.permission")
            .query(Integer.class)
            .single();

        assertThat(count).isEqualTo(PermissionCode.values().length);
    }

    @Test
    void migrationsCreateVectorAndProposalShareStorage() {
        Integer vectorExtension = jdbcClient.sql("SELECT COUNT(*) FROM pg_extension WHERE extname = 'vector'")
            .query(Integer.class)
            .single();
        Integer proposalShareTable = jdbcClient.sql("""
                SELECT COUNT(*) FROM information_schema.tables
                WHERE table_schema = 'app' AND table_name = 'proposal_share'
                """)
            .query(Integer.class)
            .single();

        assertThat(vectorExtension).isEqualTo(1);
        assertThat(proposalShareTable).isEqualTo(1);
    }

    @Test
    void databaseAllowsOnlyOneDurableStartCommandPerAgentRun() {
        UUID ownerId = insertUser("agent-command-owner");
        WorkspaceProvisioningResult workspace = provisioningService.create(
            ownerId, "Agent Command Workspace", "agent-command-workspace"
        );
        UUID projectId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        jdbcClient.sql("""
                INSERT INTO app.project (
                    id, workspace_id, title, requirement_text, currency, status, created_by
                ) VALUES (:id, :workspaceId, 'Agent project', 'Requirement', 'KRW', 'LEAD', :ownerId)
                """)
            .param("id", projectId)
            .param("workspaceId", workspace.workspaceId())
            .param("ownerId", ownerId)
            .update();
        jdbcClient.sql("""
                INSERT INTO app.agent_run (
                    id, workspace_id, project_id, thread_id, initiated_by, provider, model, status
                ) VALUES (:id, :workspaceId, :projectId, :threadId, :ownerId, 'OPENAI', 'gpt-test', 'QUEUED')
                """)
            .param("id", runId)
            .param("workspaceId", workspace.workspaceId())
            .param("projectId", projectId)
            .param("threadId", UUID.randomUUID())
            .param("ownerId", ownerId)
            .update();
        insertStartCommand(UUID.randomUUID(), runId, ownerId);

        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<UUID> first = executor.submit(() -> claimAfter(start));
            Future<UUID> second = executor.submit(() -> claimAfter(start));
            start.countDown();
            long claimed = Stream.of(first.get(), second.get())
                .filter(runId::equals)
                .count();
            assertThat(claimed).isEqualTo(1);
        } catch (Exception error) {
            throw new AssertionError("concurrent Agent command claims failed", error);
        }

        assertThatThrownBy(() -> insertStartCommand(UUID.randomUUID(), runId, ownerId))
            .isInstanceOf(DataAccessException.class);
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

    @Test
    void deletingProjectRemovesQuotationAndOutcomeAggregate() {
        UUID ownerId = insertUser("project-delete-owner");
        WorkspaceProvisioningResult workspace = provisioningService.create(
            ownerId,
            "Project Delete Workspace",
            "project-delete-workspace"
        );
        UUID projectId = UUID.randomUUID();
        UUID firstQuotationId = UUID.randomUUID();
        UUID revisedQuotationId = UUID.randomUUID();
        UUID assumptionId = UUID.randomUUID();
        UUID quotationItemId = UUID.randomUUID();
        UUID shareId = UUID.randomUUID();
        UUID outcomeId = UUID.randomUUID();

        jdbcClient.sql("""
                INSERT INTO app.project (
                    id, workspace_id, title, requirement_text, currency, status, created_by
                ) VALUES (:id, :workspaceId, 'Delete me', 'Requirement', 'KRW', 'LEAD', :ownerId)
                """)
            .param("id", projectId)
            .param("workspaceId", workspace.workspaceId())
            .param("ownerId", ownerId)
            .update();
        insertQuotation(firstQuotationId, workspace.workspaceId(), projectId, null, 1, ownerId);
        insertQuotation(revisedQuotationId, workspace.workspaceId(), projectId, firstQuotationId, 2, ownerId);
        jdbcClient.sql("""
                INSERT INTO app.quotation_assumption (
                    id, workspace_id, quotation_id, content, created_at
                ) VALUES (:id, :workspaceId, :quotationId, 'Confirmed assumption', CURRENT_TIMESTAMP)
                """)
            .param("id", assumptionId)
            .param("workspaceId", workspace.workspaceId())
            .param("quotationId", revisedQuotationId)
            .update();
        jdbcClient.sql("""
                INSERT INTO app.quotation_item (
                    id, workspace_id, quotation_id, title, quantity, unit, unit_rate,
                    subtotal, discount_rate, discount_amount, total, assumption_id,
                    sort_order, created_at
                ) VALUES (
                    :id, :workspaceId, :quotationId, 'Implementation', 1, 'FIXED', 100000,
                    100000, 0, 0, 100000, :assumptionId, 0, CURRENT_TIMESTAMP
                )
                """)
            .param("id", quotationItemId)
            .param("workspaceId", workspace.workspaceId())
            .param("quotationId", revisedQuotationId)
            .param("assumptionId", assumptionId)
            .update();
        jdbcClient.sql("""
                INSERT INTO app.proposal_share (
                    id, workspace_id, quotation_id, token_hash, expires_at, created_by, created_at
                ) VALUES (
                    :id, :workspaceId, :quotationId, :tokenHash,
                    CURRENT_TIMESTAMP + INTERVAL '7 days', :ownerId, CURRENT_TIMESTAMP
                )
                """)
            .param("id", shareId)
            .param("workspaceId", workspace.workspaceId())
            .param("quotationId", revisedQuotationId)
            .param("tokenHash", "a".repeat(64))
            .param("ownerId", ownerId)
            .update();
        jdbcClient.sql("""
                INSERT INTO app.quotation_decision (
                    id, workspace_id, quotation_id, decision, share_id, client_name, created_at
                ) VALUES (
                    :id, :workspaceId, :quotationId, 'APPROVED', :shareId, 'Client', CURRENT_TIMESTAMP
                )
                """)
            .param("id", UUID.randomUUID())
            .param("workspaceId", workspace.workspaceId())
            .param("quotationId", revisedQuotationId)
            .param("shareId", shareId)
            .update();
        jdbcClient.sql("""
                INSERT INTO app.actual_outcome (
                    id, workspace_id, project_id, approved_quotation_id, total_revenue,
                    actual_cost, actual_hours, profit_amount, created_by, created_at, updated_at
                ) VALUES (
                    :id, :workspaceId, :projectId, :quotationId, 100000,
                    60000, 8, 40000, :ownerId, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """)
            .param("id", outcomeId)
            .param("workspaceId", workspace.workspaceId())
            .param("projectId", projectId)
            .param("quotationId", revisedQuotationId)
            .param("ownerId", ownerId)
            .update();
        jdbcClient.sql("""
                INSERT INTO app.actual_work_item (
                    id, workspace_id, outcome_id, quotation_item_id, title,
                    actual_hours, actual_cost, sort_order, created_at
                ) VALUES (
                    :id, :workspaceId, :outcomeId, :quotationItemId, 'Implementation',
                    8, 60000, 0, CURRENT_TIMESTAMP
                )
                """)
            .param("id", UUID.randomUUID())
            .param("workspaceId", workspace.workspaceId())
            .param("outcomeId", outcomeId)
            .param("quotationItemId", quotationItemId)
            .update();

        int deleted = jdbcClient.sql("DELETE FROM app.project WHERE id = :projectId")
            .param("projectId", projectId)
            .update();

        assertThat(deleted).isEqualTo(1);
        assertThat(countRows("quotation", "project_id", projectId)).isZero();
        assertThat(countRows("actual_outcome", "project_id", projectId)).isZero();
        assertThat(countRows("proposal_share", "quotation_id", revisedQuotationId)).isZero();
        assertThat(countRows("quotation_decision", "quotation_id", revisedQuotationId)).isZero();
    }

    private void insertQuotation(UUID quotationId, UUID workspaceId, UUID projectId, UUID previousVersionId, int versionNumber, UUID ownerId) {
        jdbcClient.sql("""
                INSERT INTO app.quotation (
                    id, workspace_id, project_id, series_id, previous_version_id, version_number,
                    scenario, status, currency, subtotal, discount_total, risk_buffer_rate,
                    risk_buffer_amount, tax_rate, tax_amount, total, created_by, created_at, updated_at
                ) VALUES (
                    :id, :workspaceId, :projectId, :seriesId, :previousVersionId, :versionNumber,
                    'RECOMMENDED', 'DRAFT', 'KRW', 100000, 0, 0,
                    0, 0, 0, 100000, :ownerId, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """)
            .param("id", quotationId)
            .param("workspaceId", workspaceId)
            .param("projectId", projectId)
            .param("seriesId", projectId)
            .param("previousVersionId", previousVersionId)
            .param("versionNumber", versionNumber)
            .param("ownerId", ownerId)
            .update();
    }

    private Integer countRows(String table, String column, UUID id) {
        return jdbcClient.sql("SELECT COUNT(*) FROM app." + table + " WHERE " + column + " = :id")
            .param("id", id)
            .query(Integer.class)
            .single();
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

    private void insertStartCommand(UUID commandId, UUID runId, UUID ownerId) {
        jdbcClient.sql("""
                INSERT INTO app.agent_run_command (
                    id, run_id, command_type, payload, requested_by, effective_permissions, status
                ) VALUES (:id, :runId, 'START', '{}', :ownerId, '[]', 'PENDING')
                """)
            .param("id", commandId)
            .param("runId", runId)
            .param("ownerId", ownerId)
            .update();
    }

    private UUID claimAfter(CountDownLatch start) throws InterruptedException {
        start.await();
        return agentRunCommandQueue.claimNext()
            .map(AgentRunCommandQueue.ClaimedCommand::runId)
            .orElse(null);
    }
}


