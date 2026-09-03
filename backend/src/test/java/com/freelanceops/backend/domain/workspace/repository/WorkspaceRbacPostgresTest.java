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
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteObservationRepository;
import com.freelanceops.backend.domain.agentrun.entity.AgentRouteObservationEntity;
import com.freelanceops.backend.domain.agentrun.dto.request.ReviewRouteObservationRequest;
import com.freelanceops.backend.domain.agentrun.model.AgentRouteLabel;
import com.freelanceops.backend.domain.agentrun.model.RouteCorrectionSource;
import com.freelanceops.backend.domain.agentrun.service.AgentRouteReviewService;
import com.freelanceops.backend.domain.quotation.dto.request.UpdateEstimationPolicyRequest;
import com.freelanceops.backend.domain.quotation.service.PricingConfigurationService;
import com.freelanceops.backend.domain.project.model.ProjectDeletionInProgressException;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.service.AgentTaskRegistry;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskRepository;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskStatus;
import org.springframework.data.domain.PageRequest;
import com.freelanceops.backend.domain.agentrun.model.DepartmentName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.UUID;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Stream;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;

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

    @Autowired
    private AgentRouteObservationRepository agentRouteObservationRepository;

    @Autowired
    private AgentRouteReviewService agentRouteReviewService;

    @Autowired
    private PricingConfigurationService pricingConfigurationService;

    @Autowired
    private WorkspaceAuthorizationService workspaceAuthorizationService;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Autowired
    private AgentTaskRegistry taskRegistry;

    @Autowired
    private AgentTaskRepository taskRepository;

    @Test
    void concurrentFirstTaskAndAttemptRegistrationIsIdempotent() throws Exception {
        UUID ownerId = insertUser("task-registration-race");
        var workspace = provisioningService.create(ownerId, "Task race", "task-registration-race");
        UUID projectId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbcClient.sql("""
                INSERT INTO app.project (id, workspace_id, title, requirement_text, currency, status, created_by)
                VALUES (:id, :workspace, 'Task race', 'Requirement', 'KRW', 'LEAD', :owner)
                """)
            .param("id", projectId).param("workspace", workspace.workspaceId()).param("owner", ownerId).update();
        jdbcClient.sql("""
                INSERT INTO app.agent_run (id, workspace_id, project_id, thread_id, initiated_by, provider, model, status)
                VALUES (:id, :workspace, :project, :thread, :owner, 'OPENAI', 'gpt-test', 'QUEUED')
                """)
            .param("id", runId).param("workspace", workspace.workspaceId()).param("project", projectId)
            .param("thread", UUID.randomUUID()).param("owner", ownerId).update();
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        java.util.concurrent.Callable<UUID> register = () -> {
            ready.countDown();
            if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("registration start timed out");
            return new TransactionTemplate(transactionManager).execute(status -> {
                AgentTaskEntity task = new AgentTaskEntity(taskId, workspace.workspaceId(), runId, null,
                    DepartmentName.RESEARCH, "research-read-v1", "Research", "objective:1", 3, null, now);
                taskRegistry.register(task, List.of(), now);
                return taskRegistry.createAttempt(taskId, workspace.workspaceId(), 1, attemptId,
                    30.0, "pilot-static-v1", Map.of(), now).id();
            });
        };
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(register);
            var second = executor.submit(register);
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(first.get(20, TimeUnit.SECONDS)).isEqualTo(attemptId);
            assertThat(second.get(20, TimeUnit.SECONDS)).isEqualTo(attemptId);
        }
        assertThat(jdbcClient.sql("select count(*) from app.agent_task_attempt where task_id = :id")
            .param("id", taskId).query(Integer.class).single()).isEqualTo(1);
        assertThat(taskRepository.findRecoveryCandidates(List.of(workspace.workspaceId()), List.of(AgentTaskStatus.DISPATCHED), null, PageRequest.of(0, 1)))
            .extracting(AgentTaskEntity::id).containsExactly(taskId);
        assertThat(taskRepository.findRecoveryCandidates(List.of(workspace.workspaceId()), List.of(AgentTaskStatus.DISPATCHED), taskId, PageRequest.of(0, 1))).isEmpty();
        assertThat(taskRepository.findRecoveryCandidates(List.of(UUID.randomUUID()), List.of(AgentTaskStatus.DISPATCHED), null, PageRequest.of(0, 1))).isEmpty();
    }

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
    void migrationsCreateAuthoritativeAgentTaskRegistry() {
        Integer taskRegistryTables = jdbcClient.sql("""
                SELECT COUNT(*) FROM information_schema.tables
                WHERE table_schema = 'app'
                  AND table_name IN ('agent_task', 'agent_task_dependency', 'agent_task_attempt')
                """)
            .query(Integer.class)
            .single();
        Integer attemptNumberConstraint = jdbcClient.sql("""
                SELECT COUNT(*) FROM pg_constraint
                WHERE conname = 'uq_agent_task_attempt_number'
                """)
            .query(Integer.class)
            .single();

        assertThat(taskRegistryTables).isEqualTo(3);
        assertThat(attemptNumberConstraint).isEqualTo(1);
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
        TransactionTemplate deletionCheck = new TransactionTemplate(transactionManager);
        assertThatThrownBy(() -> deletionCheck.executeWithoutResult(status ->
            agentRunCommandQueue.requireNoInFlightCommands(workspace.workspaceId(), projectId)
        )).isInstanceOf(ProjectDeletionInProgressException.class);

        assertThatThrownBy(() -> insertStartCommand(UUID.randomUUID(), runId, ownerId))
            .isInstanceOf(DataAccessException.class);
    }

    @Test
    void routeReviewQueriesSeparateNaturalAndRiskStrataInPostgres() {
        UUID ownerId = insertUser("route-review-owner");
        WorkspaceProvisioningResult workspace = provisioningService.create(
            ownerId, "Route Review Workspace", "route-review-workspace"
        );
        UUID projectId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID naturalId = UUID.randomUUID();
        UUID riskId = UUID.randomUUID();
        UUID secondRiskId = UUID.randomUUID();
        jdbcClient.sql("""
                INSERT INTO app.project (
                    id, workspace_id, title, requirement_text, currency, status, created_by
                ) VALUES (:id, :workspaceId, 'Route project', 'Requirement', 'KRW', 'LEAD', :ownerId)
                """)
            .param("id", projectId)
            .param("workspaceId", workspace.workspaceId())
            .param("ownerId", ownerId)
            .update();
        jdbcClient.sql("""
                INSERT INTO app.agent_run (
                    id, workspace_id, project_id, thread_id, initiated_by, provider, model, status
                ) VALUES (:id, :workspaceId, :projectId, :threadId, :ownerId, 'OPENAI', 'gpt-test', 'COMPLETED')
                """)
            .param("id", runId)
            .param("workspaceId", workspace.workspaceId())
            .param("projectId", projectId)
            .param("threadId", UUID.randomUUID())
            .param("ownerId", ownerId)
            .update();
        insertRouteObservation(naturalId, workspace.workspaceId(), projectId, runId, 1, "SIMPLE_LLM");
        insertRouteObservation(riskId, workspace.workspaceId(), projectId, runId, 2, "HUMAN_REQUIRED");
        insertRouteObservation(secondRiskId, workspace.workspaceId(), projectId, runId, 3, "REACT_AGENT");

        assertThat(agentRouteObservationRepository.findNaturalPending(workspace.workspaceId(), 10))
            .extracting(observation -> observation.id())
            .containsExactly(naturalId);
        assertThat(agentRouteObservationRepository.findRiskPending(workspace.workspaceId(), 10))
            .extracting(observation -> observation.id())
            .containsExactly(riskId, secondRiskId);

        CountDownLatch start = new CountDownLatch(1);
        UUID firstReviewer = insertUser("route-review-first");
        UUID secondReviewer = insertUser("route-review-second");
        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<UUID> first = executor.submit(() -> claimRiskAfter(start, workspace.workspaceId(), firstReviewer));
            Future<UUID> second = executor.submit(() -> claimRiskAfter(start, workspace.workspaceId(), secondReviewer));
            start.countDown();
            assertThat(Stream.of(first.get(), second.get()).distinct().count()).isEqualTo(2);
        } catch (Exception error) {
            throw new AssertionError("concurrent route review claims failed", error);
        }
        assertThat(agentRouteObservationRepository.findRiskPending(workspace.workspaceId(), 10)).isEmpty();

        UUID consensusId = UUID.randomUUID();
        insertRouteObservation(consensusId, workspace.workspaceId(), projectId, runId, 4, "HUMAN_REQUIRED");
        UUID firstConsensusReviewer = insertUser("route-consensus-first");
        UUID secondConsensusReviewer = insertUser("route-consensus-second");
        UUID adjudicator = insertUser("route-consensus-adjudicator");
        addRole(workspace.workspaceId(), firstConsensusReviewer, ownerId, "MANAGER");
        addRole(workspace.workspaceId(), secondConsensusReviewer, ownerId, "MANAGER");
        addRole(workspace.workspaceId(), adjudicator, ownerId, "ADMIN");

        var firstClaims = agentRouteReviewService.claim(firstConsensusReviewer, workspace.workspaceId(), 2);
        assertThat(firstClaims).extracting(item -> item.id()).contains(consensusId);
        agentRouteReviewService.review(
            firstConsensusReviewer, workspace.workspaceId(), consensusId,
            new ReviewRouteObservationRequest(AgentRouteLabel.REACT_AGENT, RouteCorrectionSource.HUMAN_REVIEW)
        );
        assertThat(agentRouteReviewService.claim(secondConsensusReviewer, workspace.workspaceId(), 1))
            .extracting(item -> item.id()).containsExactly(consensusId);
        var auditRequired = agentRouteReviewService.review(
            secondConsensusReviewer, workspace.workspaceId(), consensusId,
            new ReviewRouteObservationRequest(AgentRouteLabel.REACT_AGENT, RouteCorrectionSource.HUMAN_REVIEW)
        );
        assertThat(auditRequired.reviewStatus().name()).isEqualTo("ADJUDICATION");
        assertThat(agentRouteReviewService.claimAdjudication(adjudicator, workspace.workspaceId(), 1))
            .extracting(item -> item.id()).containsExactly(consensusId);
        assertThat(agentRouteReviewService.adjudicationContext(
            adjudicator, workspace.workspaceId(), consensusId
        ).priorVotes()).containsExactly(AgentRouteLabel.REACT_AGENT, AgentRouteLabel.REACT_AGENT);
        var completed = agentRouteReviewService.review(
            adjudicator, workspace.workspaceId(), consensusId,
            new ReviewRouteObservationRequest(AgentRouteLabel.SUPERVISOR, RouteCorrectionSource.HUMAN_REVIEW)
        );

        assertThat(completed.reviewStatus().name()).isEqualTo("COMPLETED");
        assertThat(completed.reviewVotes()).isEqualTo(3);
        assertThat(completed.goldRoute()).isEqualTo(AgentRouteLabel.SUPERVISOR);
        Integer voteCount = jdbcClient.sql("""
                SELECT COUNT(*) FROM app.agent_route_review_vote WHERE observation_id = :observationId
                """)
            .param("observationId", consensusId)
            .query(Integer.class)
            .single();
        assertThat(voteCount).isEqualTo(3);
        var canary = agentRouteReviewService.canaryMetrics(
            adjudicator, workspace.workspaceId(), Instant.now().minus(Duration.ofDays(30)), 100
        );
        assertThat(canary.riskConsensusOverturn().total()).isEqualTo(1);
        assertThat(canary.riskConsensusOverturn().errors()).isEqualTo(1);
        assertThat(canary.riskAvailableConsensusAudits()).isEqualTo(1);
        assertThat(canary.riskConsensusOverturn().decision()).isEqualTo("INCONCLUSIVE");
        assertThat(canary.naturalConsensusOverturn().decision()).isEqualTo("INCONCLUSIVE");
        assertThat(canary.overallDecision()).isEqualTo("INCONCLUSIVE");

        Instant exportUntil = Instant.now();
        Instant snapshotAt = Instant.now();
        var firstExport = agentRouteReviewService.exportCohort(
            ownerId, workspace.workspaceId(), exportUntil.minus(Duration.ofDays(1)), exportUntil,
            snapshotAt, null, null, 1
        );
        assertThat(firstExport.observations()).hasSize(1);
        assertThat(firstExport.hasMore()).isTrue();
        var secondExport = agentRouteReviewService.exportCohort(
            ownerId, workspace.workspaceId(), exportUntil.minus(Duration.ofDays(1)), exportUntil,
            snapshotAt, firstExport.nextOccurredAt(), firstExport.nextObservationId(), 1
        );
        assertThat(secondExport.observations()).hasSize(1);
        assertThat(secondExport.observations().getFirst().observationId())
            .isNotEqualTo(firstExport.observations().getFirst().observationId());

        jdbcClient.sql("""
                INSERT INTO app.model_pricing (
                    id, workspace_id, provider, model, version_label, currency,
                    input_per_million, cached_input_per_million, output_per_million,
                    valid_from, created_by, created_at
                ) VALUES (
                    :id, :workspaceId, 'OPENAI', 'gpt-export', 'v1', 'USD',
                    1, 0, 10, :validFrom, :ownerId, CURRENT_TIMESTAMP
                )
                """)
            .param("id", UUID.randomUUID())
            .param("workspaceId", workspace.workspaceId())
            .param("validFrom", Timestamp.from(exportUntil.minus(Duration.ofDays(30))))
            .param("ownerId", ownerId)
            .update();
        assertThatThrownBy(() -> jdbcClient.sql("""
                INSERT INTO app.model_pricing (
                    id, workspace_id, provider, model, version_label, currency,
                    input_per_million, cached_input_per_million, output_per_million,
                    valid_from, created_by, created_at
                ) VALUES (
                    :id, :workspaceId, 'OPENAI', 'gpt-export', 'v2', 'USD',
                    2, 0, 20, :validFrom, :ownerId, CURRENT_TIMESTAMP
                )
                """)
            .param("id", UUID.randomUUID())
            .param("workspaceId", workspace.workspaceId())
            .param("validFrom", Timestamp.from(exportUntil.minus(Duration.ofDays(1))))
            .param("ownerId", ownerId)
            .update()).isInstanceOf(DataAccessException.class);
    }

    @Test
    void concurrentInitialPolicyUpsertsProduceOneWorkspacePolicy() {
        UUID ownerId = insertUser("policy-concurrency-owner");
        WorkspaceProvisioningResult workspace = provisioningService.create(
            ownerId, "Policy Workspace", "policy-concurrency-workspace"
        );
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<?> first = executor.submit(() -> updatePolicyAfter(start, ownerId, workspace.workspaceId(), "0.10"));
            Future<?> second = executor.submit(() -> updatePolicyAfter(start, ownerId, workspace.workspaceId(), "0.20"));
            start.countDown();
            first.get();
            second.get();
        } catch (Exception error) {
            throw new AssertionError("concurrent policy upserts failed", error);
        }

        Integer policies = jdbcClient.sql("SELECT COUNT(*) FROM app.estimation_policy WHERE workspace_id = :workspaceId")
            .param("workspaceId", workspace.workspaceId())
            .query(Integer.class)
            .single();
        assertThat(policies).isEqualTo(1);
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

    @Test
    void deniedAccessAuditSurvivesTheCallerTransactionRollback() {
        UUID ownerId = insertUser("rollback-audit-owner");
        UUID intruderId = insertUser("rollback-audit-intruder");
        WorkspaceProvisioningResult workspace = provisioningService.create(
            ownerId, "Rollback Audit Workspace", "rollback-audit-workspace"
        );
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);

        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
            AuthorizationDecision decision = workspaceAuthorizationService.authorize(
                intruderId, workspace.workspaceId(), PermissionCode.PROJECT_DELETE
            );
            assertThat(decision).isEqualTo(AuthorizationDecision.NOT_FOUND);
            throw new IllegalStateException("force caller rollback");
        })).isInstanceOf(IllegalStateException.class);

        Integer deniedCount = jdbcClient.sql("""
                SELECT COUNT(*) FROM app.rbac_audit_event
                WHERE actor_user_id = :actorUserId
                  AND permission_code = 'project.delete'
                  AND outcome = 'NOT_FOUND'
                """)
            .param("actorUserId", intruderId)
            .query(Integer.class)
            .single();
        assertThat(deniedCount).isEqualTo(1);
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

    private void insertRouteObservation(UUID id, UUID workspaceId, UUID projectId, UUID runId,
                                        long eventId, String route) {
        jdbcClient.sql("""
                INSERT INTO app.agent_route_observation (
                    id, workspace_id, project_id, agent_run_id, agent_event_id,
                    occurred_at, route_data, captured_at, review_target
                ) VALUES (
                    :id, :workspaceId, :projectId, :runId, :eventId,
                    CURRENT_TIMESTAMP, CAST(:routeData AS jsonb), CURRENT_TIMESTAMP, :reviewTarget
                )
                """)
            .param("id", id)
            .param("workspaceId", workspaceId)
            .param("projectId", projectId)
            .param("runId", runId)
            .param("eventId", eventId)
            .param("routeData", "{\"route\":\"" + route + "\"}")
            .param("reviewTarget", "REACT_AGENT".equals(route) || "HUMAN_REQUIRED".equals(route) ? 3 : 1)
            .update();
    }

    private void addRole(UUID workspaceId, UUID userId, UUID assignedBy, String roleCode) {
        UUID membershipId = UUID.randomUUID();
        UUID managerRoleId = jdbcClient.sql("""
                SELECT id FROM app.workspace_role WHERE workspace_id = :workspaceId AND code = :roleCode
                """)
            .param("workspaceId", workspaceId)
            .param("roleCode", roleCode)
            .query(UUID.class)
            .single();
        jdbcClient.sql("""
                INSERT INTO app.workspace_member (id, workspace_id, user_id, status, joined_at)
                VALUES (:id, :workspaceId, :userId, 'ACTIVE', CURRENT_TIMESTAMP)
                """)
            .param("id", membershipId)
            .param("workspaceId", workspaceId)
            .param("userId", userId)
            .update();
        jdbcClient.sql("""
                INSERT INTO app.member_role (workspace_id, membership_id, role_id, assigned_by)
                VALUES (:workspaceId, :membershipId, :roleId, :assignedBy)
                """)
            .param("workspaceId", workspaceId)
            .param("membershipId", membershipId)
            .param("roleId", managerRoleId)
            .param("assignedBy", assignedBy)
            .update();
    }

    private UUID claimAfter(CountDownLatch start) throws InterruptedException {
        start.await();
        return agentRunCommandQueue.claimNext()
            .map(AgentRunCommandQueue.ClaimedCommand::runId)
            .orElse(null);
    }

    private UUID claimRiskAfter(CountDownLatch start, UUID workspaceId, UUID reviewerId) throws InterruptedException {
        start.await();
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        return transaction.execute(status -> {
            AgentRouteObservationEntity observation = agentRouteObservationRepository
                .claimRiskPending(workspaceId, reviewerId, Instant.now(), 1)
                .stream()
                .findFirst()
                .orElseThrow();
            observation.claimReview(reviewerId, Instant.now(), Duration.ofMinutes(15));
            return observation.id();
        });
    }

    private void updatePolicyAfter(CountDownLatch start, UUID userId, UUID workspaceId, String taxRate) {
        try {
            start.await();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(error);
        }
        pricingConfigurationService.updatePolicy(
            userId,
            workspaceId,
            new UpdateEstimationPolicyRequest(
                new BigDecimal(taxRate), new BigDecimal("0.10"), new BigDecimal("0.30")
            )
        );
    }
}


