package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
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
@SpringBootTest(properties = {"app.environment=test", "agent.command-dispatch-enabled=false", "agent.reconciliation-enabled=false"})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Timeout(60)
class FreeUsagePostgresTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));
    @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.flyway.create-schemas", () -> true);
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
        jdbc.update("UPDATE app.weekly_credit_model_rate SET enabled = TRUE, credits = CASE model WHEN 'gpt-5.6-luna' THEN 10 ELSE 100 END");
        jdbc.update("INSERT INTO app.platform_admin_grant(user_id, capability) VALUES (?, 'FREE_USAGE_ADMIN')", admin);
        jdbc.update("UPDATE app.weekly_credit_settings SET weekly_limit = 50, updated_at = CURRENT_TIMESTAMP WHERE id = 1");
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
        assertThat(usage.current(user).reserved()).isEqualTo(50);
        assertThat(usage.current(user).remaining()).isZero();
        UUID other = account(); reserve(other, UUID.randomUUID());
        assertThat(usage.current(other).reserved()).isEqualTo(10);
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
        assertThat(usage.current(user).used()).isEqualTo(10);
        assertThat(usage.current(user).reserved()).isEqualTo(10);
        assertThat(usage.current(user).remaining()).isEqualTo(30);
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
        assertThat(usage.current(user).reserved()).isEqualTo(10);
        assertThat(jdbc.queryForObject("SELECT used FROM app.weekly_credit_bucket WHERE user_id = ? AND epoch = ?", Integer.class, user, before.epoch())).isEqualTo(10);
        assertThatThrownBy(() -> usage.resetAll(admin, FreeUsageService.RESET_CONFIRMATION, before.epoch(), before.updatedAt()))
            .isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(409));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.weekly_credit_admin_audit WHERE actor_user_id = ? AND action = 'RESET_ALL'", Integer.class, admin)).isOne();
        assertThatThrownBy(() -> jdbc.update("DELETE FROM app.weekly_credit_admin_audit WHERE actor_user_id = ?", admin))
            .isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE app.weekly_credit_admin_audit SET new_value = '99' WHERE actor_user_id = ?", admin))
            .isInstanceOf(org.springframework.dao.DataAccessException.class);
    }

    @Test void previousWeekCompletionSettlesItsOriginalBucket() {
        UUID user = account(), run = UUID.randomUUID();
        var settings = usage.adminSettings(admin);
        LocalDate oldWeek = FreeUsageService.Period.at(Instant.now()).start().minusWeeks(1);
        jdbc.update("INSERT INTO app.weekly_credit_bucket(user_id, period, epoch, reserved) VALUES (?, ?, ?, 10)", user, Date.valueOf(oldWeek), settings.epoch());
        jdbc.update("INSERT INTO app.weekly_credit_reservation(run_id,user_id,period,epoch,status,credits,provider,model,rate_version) VALUES (?,?,?,?,'RESERVED',10,'OPENAI','gpt-5.6-luna',CURRENT_TIMESTAMP)", run, user, Date.valueOf(oldWeek), settings.epoch());
        tx.executeWithoutResult(s -> usage.settleConfirmed(run, AgentRunStatus.PARTIAL));
        assertThat(usage.current(user).used()).isZero();
        assertThat(jdbc.queryForObject("SELECT used FROM app.weekly_credit_bucket WHERE user_id = ? AND period = ?", Integer.class, user, Date.valueOf(oldWeek))).isEqualTo(10);
    }

    @Test void quotaReservationRollsBackWhenStartTransactionFails() {
        UUID user = account(), run = UUID.randomUUID();
        assertThatThrownBy(() -> tx.executeWithoutResult(s -> { usage.reserve(user, run, Provider.OPENAI, "gpt-5.6-luna"); throw new IllegalStateException("outbox failure"); }))
            .isInstanceOf(IllegalStateException.class);
        assertThat(usage.current(user).reserved()).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.weekly_credit_reservation WHERE run_id = ?", Integer.class, run)).isZero();
    }

    @Test void adminAuthorityFailsClosedAndChangesAreBoundedAuditedAndOptimistic() {
        UUID normal = account();
        assertThat(usage.current(normal).canManage()).isFalse();
        assertThatThrownBy(() -> usage.adminSettings(normal)).isInstanceOfSatisfying(ResponseStatusException.class,
            e -> assertThat(e.getStatusCode().value()).isEqualTo(403));
        var before = usage.adminSettings(admin);
        assertThatThrownBy(() -> usage.changeLimit(normal, 10, before.epoch(), before.updatedAt())).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> usage.resetAll(normal, FreeUsageService.RESET_CONFIRMATION, before.epoch(), before.updatedAt())).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> usage.changeLimit(admin, 100001, before.epoch(), before.updatedAt())).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> usage.changeLimit(admin, -1, before.epoch(), before.updatedAt())).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> usage.resetAll(admin, "", before.epoch(), before.updatedAt())).isInstanceOf(ResponseStatusException.class);
        var lowered = usage.changeLimit(admin, 0, before.epoch(), before.updatedAt());
        assertThat(lowered.epoch()).isEqualTo(before.epoch());
        assertThatThrownBy(() -> reserve(normal, UUID.randomUUID())).isInstanceOf(FreeUsageExhaustedException.class);
        assertThatThrownBy(() -> usage.resetAll(admin, FreeUsageService.RESET_CONFIRMATION, before.epoch(), before.updatedAt())).isInstanceOf(ResponseStatusException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.weekly_credit_admin_audit WHERE actor_user_id = ? AND action = 'CHANGE_LIMIT'", Integer.class, admin)).isOne();
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
            usage.reserve(user, run, Provider.OPENAI, "gpt-5.6-luna");
            usage.rememberStart(user, key, workspace, project, request, accepted);
        });
        var before = usage.adminSettings(admin);
        usage.resetAll(admin, FreeUsageService.RESET_CONFIRMATION, before.epoch(), before.updatedAt());
        tx.executeWithoutResult(s -> assertThat(usage.replay(user, key, workspace, project, request).orElseThrow().runId()).isEqualTo(run));
        assertThatThrownBy(() -> tx.execute(s -> usage.replay(user, key, workspace, UUID.randomUUID(), request)))
            .isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(409));
        assertThat(usage.current(user).reserved()).isZero();
    }

    @Test void replaysHistoricalRequestHashWithoutNewNullQuoteField() throws Exception {
        UUID user = account(), workspace = UUID.randomUUID(), project = UUID.randomUUID(), run = UUID.randomUUID();
        String legacyJson = "{\"requirementText\":\"Synthetic input\",\"locale\":\"ko\",\"jurisdictionCode\":\"KR\",\"modelSelection\":null,\"budget\":null,\"safetyContext\":null}";
        String hash = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
            .digest((workspace + ":" + project + ":" + legacyJson).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        String key = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO app.agent_start_idempotency(user_id,idempotency_key,request_hash,run_id,accepted_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)", user, key, hash, run);
        var request = new StartAgentRunRequest("Synthetic input", "ko", "KR", null, null, null);
        tx.executeWithoutResult(status -> assertThat(usage.replay(user, key, workspace, project, request).orElseThrow().runId()).isEqualTo(run));
    }

    @Test void weightedModelsUseOneAccountBalanceAndUnknownModelsFailClosed() {
        UUID user = account(), expensive = UUID.randomUUID();
        var settings = usage.adminSettings(admin);
        usage.changeLimit(admin, 110, settings.epoch(), settings.updatedAt());
        tx.executeWithoutResult(status -> usage.reserve(user, expensive, Provider.OPENAI, "gpt-5.6-terra"));
        reserve(user, UUID.randomUUID());
        assertThat(usage.current(user).reserved()).isEqualTo(110);
        assertThatThrownBy(() -> reserve(user, UUID.randomUUID())).isInstanceOf(FreeUsageExhaustedException.class);
        UUID unknownUser = account();
        for (String unknown : List.of("gpt-unknown", "gpt-5.6-terra ", "GPT-5.6-LUNA")) {
            assertThatThrownBy(() -> tx.executeWithoutResult(status -> usage.reserve(unknownUser, UUID.randomUUID(), Provider.OPENAI, unknown)))
                .isInstanceOf(com.freelanceops.backend.domain.agentrun.service.CreditQuoteException.class);
        }
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> usage.reserve(unknownUser, UUID.randomUUID(), Provider.GEMINI, "gpt-5.6-luna")))
            .isInstanceOf(com.freelanceops.backend.domain.agentrun.service.CreditQuoteException.class);
        assertThat(usage.current(unknownUser).reserved()).isZero();
    }

    @Test void snapshotsCreditRateAndRequiresAnotherSendAfterPriceChanges() {
        UUID user = account(), oldRun = UUID.randomUUID();
        var before = usage.current(user);
        var quote = new StartAgentRunRequest.CreditQuote(10, before.pricingUpdatedAt());
        tx.executeWithoutResult(status -> usage.reserveQuoted(user, oldRun, Provider.OPENAI, "gpt-5.6-luna", quote));
        var settings = usage.adminSettings(admin);
        var after = usage.changeModelRate(admin, Provider.OPENAI, "gpt-5.6-luna", 20, true, settings.epoch(), settings.updatedAt());
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> usage.reserveQuoted(user, UUID.randomUUID(), Provider.OPENAI, "gpt-5.6-luna", quote)))
            .isInstanceOfSatisfying(com.freelanceops.backend.domain.agentrun.service.CreditQuoteException.class,
                error -> assertThat(error.code()).isEqualTo("CREDIT_QUOTE_STALE"));
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> usage.reserveQuoted(user, UUID.randomUUID(), Provider.OPENAI, "gpt-5.6-luna", null)))
            .isInstanceOfSatisfying(com.freelanceops.backend.domain.agentrun.service.CreditQuoteException.class,
                error -> assertThat(error.code()).isEqualTo("CREDIT_QUOTE_REQUIRED"));
        tx.executeWithoutResult(status -> usage.settleConfirmed(oldRun, AgentRunStatus.COMPLETED));
        assertThat(usage.current(user).used()).isEqualTo(10);
        var newQuote = new StartAgentRunRequest.CreditQuote(20, after.updatedAt());
        tx.executeWithoutResult(status -> usage.reserveQuoted(user, UUID.randomUUID(), Provider.OPENAI, "gpt-5.6-luna", newQuote));
        assertThat(usage.current(user).reserved()).isEqualTo(20);
        assertThatThrownBy(() -> usage.changeModelRate(admin, Provider.OPENAI, "gpt-5.6-luna", 30, true, settings.epoch(), settings.updatedAt()))
            .isInstanceOf(ResponseStatusException.class);
        var disabled = usage.changeModelRate(admin, Provider.OPENAI, "gpt-5.6-luna", 20, false, after.epoch(), after.updatedAt());
        assertThatThrownBy(() -> reserve(user, UUID.randomUUID())).isInstanceOfSatisfying(
            com.freelanceops.backend.domain.agentrun.service.CreditQuoteException.class,
            error -> assertThat(error.code()).isEqualTo("PLATFORM_MODEL_UNAVAILABLE"));
        assertThat(disabled.modelRates()).anySatisfy(rate -> {
            assertThat(rate.model()).isEqualTo("gpt-5.6-luna"); assertThat(rate.enabled()).isFalse();
        });
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.weekly_credit_admin_audit WHERE actor_user_id = ? AND action = 'CHANGE_MODEL'",
            Integer.class, admin)).isEqualTo(2);
    }

    @Test void oldMonthlyInflightRunsSettleWithoutTouchingNewCredits() {
        UUID user = account(), oldRun = UUID.randomUUID();
        LocalDate month = LocalDate.now(FreeUsageService.TIMEZONE).withDayOfMonth(1);
        jdbc.update("INSERT INTO app.free_usage_bucket(user_id, period, epoch, reserved) VALUES (?, ?, 0, 1)", user, Date.valueOf(month));
        jdbc.update("INSERT INTO app.free_usage_reservation(run_id,user_id,period,epoch,status) VALUES (?,?,?,0,'RESERVED')", oldRun, user, Date.valueOf(month));
        tx.executeWithoutResult(status -> usage.settleConfirmed(oldRun, AgentRunStatus.COMPLETED));
        assertThat(usage.current(user).used()).isZero();
        assertThat(usage.current(user).reserved()).isZero();
        assertThat(jdbc.queryForObject("SELECT used FROM app.free_usage_bucket WHERE user_id = ?", Integer.class, user)).isOne();
    }

    private void reserve(UUID user, UUID run) { tx.executeWithoutResult(s -> usage.reserve(user, run, Provider.OPENAI, "gpt-5.6-luna")); }
    private UUID account() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO app.user_account(id,external_subject,email,status) VALUES (?,?,'synthetic@example.invalid','ACTIVE')", id, "quota-test:" + id);
        return id;
    }
}
