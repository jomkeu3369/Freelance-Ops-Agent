package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.service.FreeUsageExhaustedException;
import com.freelanceops.backend.domain.agentrun.service.FreeUsageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Synthetic PostgreSQL transactions only; no Agent calls or external databases. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {"app.environment=test", "spring.flyway.create-schemas=true", "agent.command-dispatch-enabled=false", "agent.reconciliation-enabled=false"})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Timeout(60)
class FreeUsageConcurrencyPostgresTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired FreeUsageService usage;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager manager;
    private TransactionTemplate tx;
    private UUID admin;

    @BeforeEach
    void setup() {
        tx = new TransactionTemplate(manager);
        admin = account();
        jdbc.update("INSERT INTO app.platform_admin_grant(user_id, capability) VALUES (?, 'FREE_USAGE_ADMIN')", admin);
        jdbc.update("UPDATE app.free_usage_settings SET monthly_limit = 5, "
            + "updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond') WHERE id = 1");
    }

    @ParameterizedTest(name = "admission commits before concurrent admin reset={0}")
    @ValueSource(booleans = {false, true})
    void admittedReservationSerializesWithLimitChangeAndReset(boolean reset) throws Exception {
        UUID user = account(), run = UUID.randomUUID();
        var before = usage.adminSettings(admin);
        var reserved = new CountDownLatch(1);
        var commitAdmission = new CountDownLatch(1);
        var writerStarted = new CountDownLatch(1);

        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<?> admission = pool.submit(() -> tx.executeWithoutResult(status -> {
                usage.reserve(user, run);
                reserved.countDown();
                await(commitAdmission);
            }));
            Future<FreeUsageService.Settings> mutation;
            try {
                assertThat(reserved.await(10, TimeUnit.SECONDS)).isTrue();
                mutation = pool.submit(() -> {
                    writerStarted.countDown();
                    return reset
                        ? usage.resetAll(admin, FreeUsageService.RESET_CONFIRMATION, before.epoch(), before.updatedAt())
                        : usage.changeLimit(admin, 0, before.epoch(), before.updatedAt());
                });
                assertThat(writerStarted.await(10, TimeUnit.SECONDS)).isTrue();
                // The pending admission owns settings FOR SHARE until it commits.
                // Neither writer may publish a new limit/epoch while that lock is held.
                assertThatThrownBy(() -> mutation.get(250, TimeUnit.MILLISECONDS))
                    .isInstanceOf(TimeoutException.class);
            } finally {
                commitAdmission.countDown();
            }
            admission.get(10, TimeUnit.SECONDS);
            var after = mutation.get(10, TimeUnit.SECONDS);
            assertThat(after.epoch()).isEqualTo(before.epoch() + (reset ? 1 : 0));
            assertThat(jdbc.queryForObject("SELECT epoch FROM app.free_usage_reservation WHERE run_id = ?", Long.class, run))
                .isEqualTo(before.epoch());

            if (reset) {
                assertThat(usage.current(user).reserved()).isZero();
                UUID fresh = UUID.randomUUID();
                tx.executeWithoutResult(status -> usage.reserve(user, fresh));
                tx.executeWithoutResult(status -> usage.settleConfirmed(run, AgentRunStatus.COMPLETED));
                assertThat(usage.current(user).used()).isZero();
                assertThat(usage.current(user).reserved()).isOne();
                assertThat(jdbc.queryForObject("SELECT used FROM app.free_usage_bucket WHERE user_id = ? AND epoch = ?",
                    Integer.class, user, before.epoch())).isOne();
            } else {
                assertThat(usage.current(user).limit()).isZero();
                assertThat(usage.current(user).reserved()).isOne();
                assertThatThrownBy(() -> tx.executeWithoutResult(status -> usage.reserve(user, UUID.randomUUID())))
                    .isInstanceOf(FreeUsageExhaustedException.class);
                tx.executeWithoutResult(status -> usage.settleConfirmed(run, AgentRunStatus.COMPLETED));
                assertThat(usage.current(user).used()).isOne();
                assertThat(usage.current(user).reserved()).isZero();
            }
            assertThat(jdbc.queryForObject("SELECT count(*) FROM app.free_usage_admin_audit WHERE actor_user_id = ?",
                Integer.class, admin)).isOne();
        }
    }

    @Test
    void concurrentSameKeyCreatesOneReservationAndRemainsAccountBound() throws Exception {
        UUID user = account(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
        String key = UUID.randomUUID().toString();
        var request = new StartAgentRunRequest("Synthetic concurrent request", "ko-KR", "KR", null, null, null);
        int workers = 12;
        var ready = new CountDownLatch(workers);
        var start = new CountDownLatch(1);

        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<UUID>> results = new ArrayList<>();
            for (int index = 0; index < workers; index++) {
                results.add(pool.submit(() -> {
                    ready.countDown();
                    await(start);
                    return admit(user, key, workspace, project, request);
                }));
            }
            try {
                assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            } finally {
                start.countDown();
            }
            UUID accepted = results.getFirst().get(10, TimeUnit.SECONDS);
            for (var result : results) assertThat(result.get(10, TimeUnit.SECONDS)).isEqualTo(accepted);

            assertThat(usage.current(user).reserved()).isOne();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM app.agent_start_idempotency WHERE user_id = ?",
                Integer.class, user)).isOne();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM app.free_usage_reservation WHERE user_id = ?",
                Integer.class, user)).isOne();

            UUID otherAccount = account();
            UUID otherRun = admit(otherAccount, key, workspace, project, request);
            assertThat(otherRun).isNotEqualTo(accepted);
            assertThat(usage.current(otherAccount).reserved()).isOne();
            assertThat(usage.current(user).reserved()).isOne();
        }
    }

    @Test
    void concurrentDuplicateTerminalViewsSettleExactlyOnce() throws Exception {
        UUID user = account(), run = UUID.randomUUID();
        tx.executeWithoutResult(status -> usage.reserve(user, run));
        int workers = 12;
        var ready = new CountDownLatch(workers);
        var start = new CountDownLatch(1);

        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<?>> results = new ArrayList<>();
            for (int index = 0; index < workers; index++) {
                results.add(pool.submit(() -> {
                    ready.countDown();
                    await(start);
                    tx.executeWithoutResult(status -> usage.settleConfirmed(run, AgentRunStatus.COMPLETED));
                }));
            }
            try {
                assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            } finally {
                start.countDown();
            }
            for (var result : results) result.get(10, TimeUnit.SECONDS);
        }
        assertThat(usage.current(user).used()).isOne();
        assertThat(usage.current(user).reserved()).isZero();
        assertThat(usage.current(user).remaining()).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT status FROM app.free_usage_reservation WHERE run_id = ?",
            String.class, run)).isEqualTo("CONSUMED");
        assertThat(jdbc.queryForObject("SELECT settled_at IS NOT NULL FROM app.free_usage_reservation WHERE run_id = ?",
            Boolean.class, run)).isTrue();
    }

    private UUID admit(UUID user, String key, UUID workspace, UUID project, StartAgentRunRequest request) {
        return tx.execute(status -> {
            var replay = usage.replay(user, key, workspace, project, request);
            if (replay.isPresent()) return replay.get().runId();
            UUID run = UUID.randomUUID();
            usage.reserve(user, run);
            usage.rememberStart(user, key, workspace, project, request,
                new StartAgentRunResponse(run, AgentRunStatus.QUEUED, Instant.now()));
            return run;
        });
    }

    private UUID account() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO app.user_account(id, external_subject, email, status) VALUES (?, ?, 'synthetic@example.invalid', 'ACTIVE')",
            id, "quota-concurrency-test:" + id);
        return id;
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(15, TimeUnit.SECONDS)) throw new IllegalStateException("Concurrency test barrier timed out");
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Concurrency test interrupted", interrupted);
        }
    }
}
