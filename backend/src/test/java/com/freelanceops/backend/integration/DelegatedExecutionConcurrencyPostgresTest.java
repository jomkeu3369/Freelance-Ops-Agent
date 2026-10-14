package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.ByokBudget;
import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.*;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.agentrun.service.*;
import com.freelanceops.backend.domain.client.entity.ClientEntity;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenException;
import com.freelanceops.backend.domain.internaltool.service.DelegatedExecutionAccess;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.AuthorizationAuditSink;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import org.hibernate.StaleObjectStateException;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.orm.jpa.*;
import org.springframework.orm.jpa.persistenceunit.PersistenceManagedTypes;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import javax.sql.DataSource;
import java.net.URI;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Real PG17/JPA/version/transactions/BYOK scope. Permission and connection lookup are synthetic, no provider I/O. */
@SpringJUnitConfig(DelegatedExecutionConcurrencyPostgresTest.Config.class)
@EnabledIf("databaseAvailable")
@Timeout(30)
class DelegatedExecutionConcurrencyPostgresTest {
    private static final List<String> SCOPE = List.of("agent.run", "project.read");
    private static PostgreSQLContainer ownedContainer;
    @Autowired AgentRunRepository runs;
    @Autowired ProjectRepository projects;
    @Autowired ByokExecutionService byok;
    @Autowired DelegatedExecutionAccess access;
    @Autowired AgentRunProjectionService projection;
    @Autowired AgentRunGatewayService gateway;
    @Autowired WorkspacePermissionReader permissions;
    @Autowired AgentRunCommandQueue commands;
    @Autowired AIConnectionService connections;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired PlatformTransactionManager manager;
    private TransactionTemplate transaction;
    private ExecutorService workers;
    private AgentRunEntity run;
    private DelegationPrincipal principal;
    private MembershipPermissions membership;

    static boolean databaseAvailable() {
        return System.getenv("BACKEND_LOCK_TEST_JDBC_URL") != null || DockerClientFactory.instance().isDockerAvailable();
    }

    @BeforeEach
    void prepareIsolatedAuthority() throws Exception {
        AgentRunCommandQueue commandFixture = org.springframework.test.util.AopTestUtils.getUltimateTargetObject(commands);
        AIConnectionService connectionFixture = org.springframework.test.util.AopTestUtils.getUltimateTargetObject(connections);
        reset(permissions);
        reset(commandFixture);
        reset(connectionFixture);
        workers = Executors.newFixedThreadPool(2);
        transaction = new TransactionTemplate(manager);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS app.byok_execution_scope (
              scope_id UUID PRIMARY KEY, run_id UUID UNIQUE NOT NULL, payload JSONB NOT NULL,
              valid_until TIMESTAMPTZ NOT NULL, closed BOOLEAN NOT NULL DEFAULT FALSE,
              model_calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0,
              output_tokens INTEGER NOT NULL DEFAULT 0)
            """);
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
        UUID credential = UUID.randomUUID();
        Instant created = Instant.now();
        var budget = new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget(
            180, 2, 12, 20000, 1000, 4, 2, 0, 1, 3);
        run = new AgentRunEntity(UUID.randomUUID(), workspace, project, UUID.randomUUID(), user, Provider.OPENAI,
            "gpt-test", ReasoningEffort.LOW, budget, AgentRunStatus.RUNNING, created);
        run.useCredential(credential);
        var scope = new ByokBudget(UUID.randomUUID(), run.id(), workspace, project, user, credential,
            Provider.OPENAI, "gpt-test", ReasoningEffort.LOW, "BYOK", "default", created.plusSeconds(180),
            budget.maxModelCalls(), budget.maxInputTokens(), budget.maxOutputTokens(), budget);
        String payload = mapper.writeValueAsString(scope);
        transaction.executeWithoutResult(status -> {
            projects.saveAndFlush(new ProjectEntity(project, workspace, "Synthetic", "Synthetic", "USD", null, null, null));
            runs.saveAndFlush(run);
            jdbc.update("INSERT INTO app.byok_execution_scope(scope_id,run_id,payload,valid_until) VALUES (?,?,?::jsonb,?)",
                scope.scopeId(), run.id(), payload, java.sql.Timestamp.from(scope.validUntil()));
        });
        membership = new MembershipPermissions(UUID.randomUUID(), Set.of(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ));
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(membership));
        when(commandFixture.originalPermissions(run.id())).thenReturn(SCOPE);
        principal = new DelegationPrincipal(user.toString(), UUID.randomUUID().toString(), run.id(), workspace, project,
            user, Set.copyOf(SCOPE), created.plusSeconds(180).truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
    }

    @AfterEach
    void finishOnlyOwnedWorkers() throws Exception {
        workers.shutdownNow();
        assertThat(workers.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
    }

    @AfterAll
    static void stopOnlyOwnedContainer() {
        if (ownedContainer != null) ownedContainer.stop();
    }

    @Test
    void unlockedReadThenLockUpgradeReproducesTheReportedVersionFailure() throws Exception {
        var read = new CountDownLatch(1);
        var updated = new CountDownLatch(1);
        Future<?> oldPath = workers.submit(() -> transaction.executeWithoutResult(status -> {
            var cached = runs.findByIdAndWorkspaceId(run.id(), run.workspaceId()).orElseThrow();
            read.countDown();
            await(updated);
            byok.validateRun(cached);
        }));
        try {
            await(read);
            projection.deferReconciliation(run.id(), run.workspaceId(), Instant.now().plusSeconds(5));
        } finally { updated.countDown(); }
        Throwable failure = catchThrowable(() -> oldPath.get(5, TimeUnit.SECONDS));
        assertThat(failure).isNotNull();
        while (failure.getCause() != null) failure = failure.getCause();
        assertThat(failure).isInstanceOf(StaleObjectStateException.class);
        assertThat(version()).isEqualTo(1);
    }

    @RepeatedTest(3)
    void authorizationLocksBeforeProjectionAndKeepsScopeAndCountersUnchanged() throws Exception {
        var checked = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        when(permissions.findActiveMembership(run.initiatedBy(), run.workspaceId())).thenAnswer(call -> {
            checked.countDown(); await(release); return Optional.of(membership);
        });
        var before = scopeState();
        Future<?> authorization = workers.submit(() -> access.require(principal));
        Future<?> update = null;
        try {
            await(checked);
            var writerPid = new AtomicInteger();
            update = workers.submit(() -> transaction.executeWithoutResult(status -> {
                writerPid.set(jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class));
                projection.deferReconciliation(run.id(), run.workspaceId(), Instant.now().plusSeconds(5));
            }));
            assertBlocked(writerPid, update);
        } finally { release.countDown(); }
        authorization.get(5, TimeUnit.SECONDS);
        if (update != null) update.get(5, TimeUnit.SECONDS);
        assertThat(version()).isEqualTo(1);
        assertThat(scopeState()).isEqualTo(before);
        assertThat(jdbc.queryForObject("SELECT status FROM app.agent_run WHERE id=?", String.class, run.id())).isEqualTo("RUNNING");
    }

    @Test
    void publicResumeLocksBeforeCredentialValidationAndConcurrentProjection() throws Exception {
        projection.synchronizeStatus(run.id(), run.workspaceId(), AgentRunStatus.WAITING_FOR_USER);
        int beforeVersion = version();
        var loaded = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var resumePermissions = new MembershipPermissions(membership.membershipId(),
            Set.of(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ, PermissionCode.AGENT_RESPOND));
        when(permissions.findActiveMembership(run.initiatedBy(), run.workspaceId())).thenReturn(Optional.of(resumePermissions));
        AIConnectionService connectionFixture = org.springframework.test.util.AopTestUtils.getUltimateTargetObject(connections);
        doAnswer(call -> { loaded.countDown(); await(release); return null; }).when(connectionFixture)
            .validate(run.initiatedBy(), run.workspaceId(), run.credentialId(), run.provider(), run.model());
        var response = new ResumeAgentRunRequest(
            UUID.randomUUID(), "synthetic-public-resume", List.of(
                new ResumeAgentRunRequest.ResumeAnswer(0, "Synthetic")));
        var before = scopeState();
        Future<StartAgentRunResponse> resumed = workers.submit(() -> gateway.resume(run.initiatedBy(), run.workspaceId(), run.id(), response, "synthetic"));
        Future<?> update = null;
        try {
            await(loaded);
            var writerPid = new AtomicInteger();
            update = workers.submit(() -> transaction.executeWithoutResult(status -> {
                writerPid.set(jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class));
                projection.deferReconciliation(run.id(), run.workspaceId(), Instant.now().plusSeconds(5));
            }));
            assertBlocked(writerPid, update);
        } finally { release.countDown(); }
        assertThat(resumed.get(5, TimeUnit.SECONDS).status()).isEqualTo(AgentRunStatus.QUEUED);
        if (update != null) update.get(5, TimeUnit.SECONDS);
        assertThat(version()).isEqualTo(beforeVersion + 2);
        assertThat(scopeState()).isEqualTo(before);
        assertThat(jdbc.queryForObject("SELECT status FROM app.agent_run WHERE id=?", String.class, run.id())).isEqualTo("QUEUED");
    }

    @Test
    void waitingAuthorizationObservesCommittedCancellationAndRejectsIt() throws Exception {
        var cancelled = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        Future<?> update = workers.submit(() -> transaction.executeWithoutResult(status -> {
            projection.synchronizeStatus(run.id(), run.workspaceId(), AgentRunStatus.CANCELLED);
            cancelled.countDown(); await(release);
        }));
        Future<?> authorization = null;
        try {
            await(cancelled);
            var readerPid = new AtomicInteger();
            authorization = workers.submit(() -> transaction.executeWithoutResult(status -> {
                readerPid.set(jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class));
                access.require(principal);
            }));
            assertBlocked(readerPid, authorization);
        } finally { release.countDown(); }
        update.get(5, TimeUnit.SECONDS);
        Future<?> completedAuthorization = authorization;
        Throwable failure = catchThrowable(() -> completedAuthorization.get(5, TimeUnit.SECONDS));
        assertThat(failure).isNotNull();
        while (failure.getCause() != null) failure = failure.getCause();
        assertThat(failure).isInstanceOf(DelegationTokenException.class);
        assertThat(jdbc.queryForObject("SELECT closed FROM app.byok_execution_scope WHERE run_id=?", Boolean.class, run.id())).isTrue();
        AIConnectionService connectionFixture = org.springframework.test.util.AopTestUtils.getUltimateTargetObject(connections);
        verifyNoInteractions(connectionFixture);
    }

    private void assertBlocked(AtomicInteger pid, Future<?> waiter) throws Exception {
        long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        boolean blocked = false;
        while (!waiter.isDone() && System.nanoTime() < until) {
            if (pid.get() != 0) {
                blocked = Boolean.TRUE.equals(jdbc.queryForObject("""
                    SELECT wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid)) > 0
                    FROM pg_stat_activity WHERE pid=? AND datname=current_database()
                    """, Boolean.class, pid.get()));
                if (blocked) break;
            }
            Thread.sleep(10);
        }
        assertThat(blocked).as("actual PostgreSQL waiter must block on the first run lock").isTrue();
    }

    private int version() {
        return jdbc.queryForObject("SELECT version FROM app.agent_run WHERE id=?", Integer.class, run.id());
    }

    private Map<String, Object> scopeState() {
        return jdbc.queryForMap("SELECT payload::text,valid_until,closed,model_calls,input_tokens,output_tokens FROM app.byok_execution_scope WHERE run_id=?", run.id());
    }

    private static void await(CountDownLatch latch) {
        try { if (!latch.await(5, TimeUnit.SECONDS)) throw new AssertionError("concurrency checkpoint timed out"); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new AssertionError(error); }
    }

    @Configuration(proxyBeanMethods=false)
    @EnableTransactionManagement(proxyTargetClass=true)
    static class Config {
        @Bean DataSource dataSource() {
            String url = System.getenv("BACKEND_LOCK_TEST_JDBC_URL");
            String user = "test", password = "test"; // Existing isolated PostgreSQL test fixture, never operational login.
            if (url != null) {
                URI target = URI.create(url.substring("jdbc:".length()));
                if (!("127.0.0.1".equals(target.getHost()) || "localhost".equals(target.getHost()))
                    || target.getPort() < 18100 || target.getPort() > 18149 || !"/backend_lock_test".equals(target.getPath()))
                    throw new IllegalArgumentException("External race tests require the dedicated localhost backend_lock_test database");
            } else {
                ownedContainer = new PostgreSQLContainer(DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));
                ownedContainer.start();
                url = ownedContainer.getJdbcUrl(); user = ownedContainer.getUsername(); password = ownedContainer.getPassword();
            }
            return new DriverManagerDataSource(url, user, password);
        }
        @Bean LocalContainerEntityManagerFactoryBean entityManagerFactory(DataSource source) {
            var factory = new LocalContainerEntityManagerFactoryBean();
            factory.setDataSource(source);
            factory.setManagedTypes(PersistenceManagedTypes.of(AgentRunEntity.class.getName(), ProjectEntity.class.getName(), ClientEntity.class.getName()));
            factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
            factory.setJpaPropertyMap(Map.of("hibernate.hbm2ddl.auto", "create", "hibernate.hbm2ddl.create_namespaces", "true"));
            return factory;
        }
        @Bean PlatformTransactionManager transactionManager(EntityManagerFactory factory) { return new JpaTransactionManager(factory); }
        @Bean EntityManager entityManager(EntityManagerFactory factory) { return SharedEntityManagerCreator.createSharedEntityManager(factory); }
        @Bean AgentRunRepository runs(EntityManager entityManager) { return new JpaRepositoryFactory(entityManager).getRepository(AgentRunRepository.class); }
        @Bean ProjectRepository projects(EntityManager entityManager) { return new JpaRepositoryFactory(entityManager).getRepository(ProjectRepository.class); }
        @Bean JdbcTemplate jdbc(DataSource source) { return new JdbcTemplate(source); }
        @Bean ObjectMapper mapper() { return JsonMapper.builder().findAndAddModules().build(); }
        @Bean WorkspacePermissionReader permissions() { return mock(WorkspacePermissionReader.class); }
        @Bean AgentRunCommandQueue commands() { return mock(AgentRunCommandQueue.class); }
        @Bean AIConnectionService connections() { return mock(AIConnectionService.class); }
        @Bean WorkspaceAuthorizationService authorization(WorkspacePermissionReader reader) { return new WorkspaceAuthorizationService(reader, mock(AuthorizationAuditSink.class)); }
        @Bean ByokExecutionService byok(JdbcTemplate jdbc, ObjectMapper mapper, AIConnectionService connections,
                                      WorkspaceAuthorizationService authorization, AgentRunRepository runs, ProjectRepository projects) {
            return new ByokExecutionService(jdbc, mapper, connections, authorization, runs, projects, mock(AgentBudgetPolicy.class));
        }
        @Bean DelegatedExecutionAccess access(AgentRunRepository runs, ProjectRepository projects,
                                             WorkspacePermissionReader permissions, AgentRunCommandQueue commands, ByokExecutionService byok) {
            return new DelegatedExecutionAccess(runs, projects, permissions, commands, byok);
        }
        @Bean AgentRunProjectionService projection(AgentRunRepository runs, ByokExecutionService byok) {
            return new AgentRunProjectionService(runs, mock(AgentInterruptionService.class), mock(AgentCostService.class),
                mock(ApplicationEventPublisher.class), mock(FreeUsageService.class), byok);
        }
        @Bean AgentRunGatewayService gateway(WorkspacePermissionReader permissions, ProjectRepository projects,
                                             AgentRunRepository runs, AgentRunProjectionService projection,
                                             AgentRunCommandQueue commands, AIConnectionService connections, ByokExecutionService byok) {
            return new AgentRunGatewayService(permissions, projects, runs,
                mock(DelegationTokenIssuer.class), mock(AgentRunClient.class), projection, commands,
                mock(AgentBudgetPolicy.class), connections, mock(PetProfileService.class), mock(FreeUsageService.class),
                mock(PlatformSpendService.class), mock(ChatAttachmentService.class), byok);
        }
    }
}
