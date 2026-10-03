package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.service.FreeUsageExhaustedException;
import com.freelanceops.backend.domain.agentrun.service.FreeUsageService;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.sql.Date;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.*;

import static org.assertj.core.api.Assertions.*;

/** Actual service transactions on PostgreSQL, never a production database or real model call. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {"app.environment=test", "spring.flyway.create-schemas=true", "agent.command-dispatch-enabled=false", "agent.reconciliation-enabled=false"})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Timeout(60)
class FreeUsagePostgresTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));
    @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }
    @Autowired MockMvc mvc;
    @Autowired FreeUsageService usage;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager manager;
    private TransactionTemplate tx;
    private UUID admin;
    @BeforeEach void setup() {
        tx = new TransactionTemplate(manager);
        admin = account();
        jdbc.update("INSERT INTO app.platform_admin_grant(user_id, capability) VALUES (?, 'FREE_USAGE_ADMIN')", admin);
        jdbc.update("UPDATE app.free_usage_settings SET monthly_limit = 5, updated_at = CURRENT_TIMESTAMP WHERE id = 1");
    }

    @Test void adminHttpRejectsAnonymousAndWorkspaceAdminClaims() throws Exception {
        mvc.perform(get("/api/v2/admin/free-usage")).andExpect(status().isUnauthorized());
        UUID user = account();
        mvc.perform(get("/api/v2/admin/free-usage").with(jwt().jwt(token -> token.subject(user.toString()))
            .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"), new SimpleGrantedAuthority("ROLE_OWNER"))))
            .andExpect(status().isForbidden());
        mvc.perform(post("/api/v2/admin/free-usage/reset").with(jwt().jwt(token -> token.subject(user.toString())))
            .contentType("application/json").content("{\"confirmation\":\"RESET_ALL_FREE_USAGE\",\"expectedEpoch\":0,\"expectedUpdatedAt\":\"2026-10-01T00:00:00Z\"}"))
            .andExpect(status().isForbidden());
    }

    @Test void concurrentAccountStartsCannotReserveMoreThanFiveAndOtherAccountsAreIsolated() throws Exception {
        UUID user = account();
        var ready = new CountDownLatch(16);
        var start = new CountDownLatch(1);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<Boolean>> tasks = new ArrayList<>();
            for (int i = 0; i < 16; i++) tasks.add(pool.submit(() -> {
                ready.countDown(); start.await();
                try { reserve(user, UUID.randomUUID()); return true; }
                catch (FreeUsageExhaustedException exhausted) { return false; }
            }));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue(); start.countDown();
            int accepted = 0;
            for (var task : tasks) if (task.get()) accepted++;
            assertThat(accepted).isEqualTo(5);
        }
        assertThat(usage.current(user).reserved()).isEqualTo(5);
        assertThat(usage.current(user).remaining()).isZero();
        UUID other = account(); reserve(other, UUID.randomUUID());
        assertThat(usage.current(other).reserved()).isOne();
    }

    @Test void duplicateTerminalEventsDoNotDoubleCountAndOnlyConfirmedFailuresRelease() {
        UUID user = account(), completed = UUID.randomUUID(), failed = UUID.randomUUID(), waiting = UUID.randomUUID();
        reserve(user, completed); reserve(user, failed); reserve(user, waiting);
        tx.executeWithoutResult(s -> {
            usage.settleConfirmed(completed, AgentRunStatus.COMPLETED);
            usage.settleConfirmed(completed, AgentRunStatus.COMPLETED);
            usage.settleConfirmed(completed, AgentRunStatus.CANCELLED);
            usage.settleConfirmed(failed, AgentRunStatus.FAILED);
            usage.settleConfirmed(failed, AgentRunStatus.FAILED);
            usage.settleConfirmed(waiting, AgentRunStatus.WAITING_FOR_USER);
        });
        assertThat(usage.current(user).used()).isOne();
        assertThat(usage.current(user).reserved()).isOne();
        assertThat(usage.current(user).remaining()).isEqualTo(3);
    }

    @Test void resetKeepsHistoricalInflightLedgerAndStaleResetCannotRepeat() {
        UUID user = account(), old = UUID.randomUUID(); reserve(user, old);
        var before = usage.adminSettings(admin);
        var after = usage.resetAll(admin, FreeUsageService.RESET_CONFIRMATION, before.epoch(), before.updatedAt());
        assertThat(after.epoch()).isEqualTo(before.epoch() + 1);
        assertThat(usage.current(user).reserved()).isZero();
        UUID fresh = UUID.randomUUID(); reserve(user, fresh);
        tx.executeWithoutResult(s -> usage.settleConfirmed(old, AgentRunStatus.COMPLETED));
        assertThat(usage.current(user).used()).isZero();
        assertThat(usage.current(user).reserved()).isOne();
        assertThat(jdbc.queryForObject("SELECT used FROM app.free_usage_bucket WHERE user_id = ? AND epoch = ?", Integer.class, user, before.epoch())).isOne();
        assertThatThrownBy(() -> usage.resetAll(admin, FreeUsageService.RESET_CONFIRMATION, before.epoch(), before.updatedAt()))
            .isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(409));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.free_usage_admin_audit WHERE actor_user_id = ? AND action = 'RESET_ALL'", Integer.class, admin)).isOne();
        assertThatThrownBy(() -> jdbc.update("DELETE FROM app.free_usage_admin_audit WHERE actor_user_id = ?", admin))
            .isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE app.free_usage_admin_audit SET new_limit = 99 WHERE actor_user_id = ?", admin))
            .isInstanceOf(org.springframework.dao.DataAccessException.class);
    }

    @Test void previousMonthCompletionSettlesItsOriginalBucket() {
        UUID user = account(), run = UUID.randomUUID();
        var settings = usage.adminSettings(admin);
        LocalDate oldMonth = FreeUsageService.Period.at(Instant.now()).start().minusMonths(1);
        jdbc.update("INSERT INTO app.free_usage_bucket(user_id, period, epoch, reserved) VALUES (?, ?, ?, 1)", user, Date.valueOf(oldMonth), settings.epoch());
        jdbc.update("INSERT INTO app.free_usage_reservation(run_id,user_id,period,epoch,status) VALUES (?,?,?,?,'RESERVED')", run, user, Date.valueOf(oldMonth), settings.epoch());
        tx.executeWithoutResult(s -> usage.settleConfirmed(run, AgentRunStatus.PARTIAL));
        assertThat(usage.current(user).used()).isZero();
        assertThat(jdbc.queryForObject("SELECT used FROM app.free_usage_bucket WHERE user_id = ? AND period = ?", Integer.class, user, Date.valueOf(oldMonth))).isOne();
    }

    @Test void quotaReservationRollsBackWhenStartTransactionFails() {
        UUID user = account(), run = UUID.randomUUID();
        assertThatThrownBy(() -> tx.executeWithoutResult(s -> { usage.reserve(user, run); throw new IllegalStateException("outbox failure"); }))
            .isInstanceOf(IllegalStateException.class);
        assertThat(usage.current(user).reserved()).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.free_usage_reservation WHERE run_id = ?", Integer.class, run)).isZero();
    }

    @Test void adminAuthorityFailsClosedAndChangesAreBoundedAuditedAndOptimistic() {
        UUID normal = account();
        assertThat(usage.current(normal).canManage()).isFalse();
        assertThatThrownBy(() -> usage.adminSettings(normal)).isInstanceOfSatisfying(ResponseStatusException.class,
            e -> assertThat(e.getStatusCode().value()).isEqualTo(403));
        var before = usage.adminSettings(admin);
        assertThatThrownBy(() -> usage.changeLimit(normal, 10, before.epoch(), before.updatedAt())).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> usage.resetAll(normal, FreeUsageService.RESET_CONFIRMATION, before.epoch(), before.updatedAt())).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> usage.changeLimit(admin, 101, before.epoch(), before.updatedAt())).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> usage.changeLimit(admin, -1, before.epoch(), before.updatedAt())).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> usage.resetAll(admin, "", before.epoch(), before.updatedAt())).isInstanceOf(ResponseStatusException.class);
        var lowered = usage.changeLimit(admin, 0, before.epoch(), before.updatedAt());
        assertThat(lowered.epoch()).isEqualTo(before.epoch());
        assertThatThrownBy(() -> reserve(normal, UUID.randomUUID())).isInstanceOf(FreeUsageExhaustedException.class);
        assertThatThrownBy(() -> usage.resetAll(admin, FreeUsageService.RESET_CONFIRMATION, before.epoch(), before.updatedAt())).isInstanceOf(ResponseStatusException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.free_usage_admin_audit WHERE actor_user_id = ? AND action = 'CHANGE_LIMIT'", Integer.class, admin)).isOne();
        jdbc.update("UPDATE app.platform_admin_grant SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ?", admin);
        assertThatThrownBy(() -> usage.adminSettings(admin)).isInstanceOf(ResponseStatusException.class);
    }

    @Test void requestIdempotencySurvivesResetAndRejectsDifferentScope() {
        UUID user = account(), workspace = UUID.randomUUID(), project = UUID.randomUUID(), run = UUID.randomUUID();
        String key = UUID.randomUUID().toString();
        StartAgentRunRequest request = new StartAgentRunRequest("Synthetic input", "ko", "KR", null, null, null);
        var accepted = new StartAgentRunResponse(run, AgentRunStatus.QUEUED, Instant.now());
        tx.executeWithoutResult(s -> {
            assertThat(usage.replay(user, key, workspace, project, request)).isEmpty();
            usage.reserve(user, run);
            usage.rememberStart(user, key, workspace, project, request, accepted);
        });
        var before = usage.adminSettings(admin);
        usage.resetAll(admin, FreeUsageService.RESET_CONFIRMATION, before.epoch(), before.updatedAt());
        tx.executeWithoutResult(s -> assertThat(usage.replay(user, key, workspace, project, request).orElseThrow().runId()).isEqualTo(run));
        assertThatThrownBy(() -> tx.execute(s -> usage.replay(user, key, workspace, UUID.randomUUID(), request)))
            .isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(409));
        assertThat(usage.current(user).reserved()).isZero();
    }

    private void reserve(UUID user, UUID run) { tx.executeWithoutResult(s -> usage.reserve(user, run)); }
    private UUID account() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO app.user_account(id,external_subject,email,status) VALUES (?,?,'synthetic@example.invalid','ACTIVE')", id, "quota-test:" + id);
        return id;
    }
}
