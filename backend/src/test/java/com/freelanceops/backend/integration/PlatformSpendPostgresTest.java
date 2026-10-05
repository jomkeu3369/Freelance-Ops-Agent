package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendExhaustedException;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
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

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.*;

/** Synthetic transactions in a disposable PostgreSQL container only. Never calls a provider. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {"app.environment=test", "platform.ai.spend.enabled=true",
    "agent.command-dispatch-enabled=false", "agent.reconciliation-enabled=false"})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Timeout(60)
class PlatformSpendPostgresTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));
    @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.flyway.create-schemas", () -> true);
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }
    @Autowired PlatformSpendService spend;
    @Autowired com.freelanceops.backend.domain.agentrun.service.FreeUsageService credits;
    @Autowired com.freelanceops.backend.domain.agentrun.service.AgentCostService costs;
    @Autowired com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository runs;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager manager;
    private TransactionTemplate tx;
    private static final ModelSelection LUNA = new ModelSelection(Provider.OPENAI, "gpt-5.6-luna", ReasoningEffort.LOW);

    @BeforeEach void setup() {
        tx = new TransactionTemplate(manager);
        // Test-fixture cleanup only, in the dedicated disposable container above.
        jdbc.execute("TRUNCATE app.agent_run_usage, app.platform_provider_attempt, app.platform_spend_settlement, app.platform_spend_reservation, app.platform_spend_bucket");
        jdbc.update("UPDATE app.platform_spend_settings SET luna_run_usd=.10,terra_run_usd=1,account_week_usd=1.25,global_day_usd=25,global_week_usd=100 WHERE id=1");
    }

    @Test void concurrentIndependentInstancesCannotOverspendOneAccount() throws Exception {
        UUID user = UUID.randomUUID();
        var secondInstance = new PlatformSpendService(jdbc, true);
        var ready = new CountDownLatch(16);
        var start = new CountDownLatch(1);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<Boolean>> results = new ArrayList<>();
            for (int i = 0; i < 16; i++) {
                PlatformSpendService instance = i % 2 == 0 ? spend : secondInstance;
                results.add(pool.submit(() -> {
                    ready.countDown();
                    if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Barrier timeout");
                    try {
                        tx.executeWithoutResult(s -> instance.reserve(user, UUID.randomUUID(), LUNA));
                        return true;
                    } catch (PlatformSpendExhaustedException exhausted) { return false; }
                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            int accepted = 0;
            for (var result : results) if (result.get(20, TimeUnit.SECONDS)) accepted++;
            assertThat(accepted).isEqualTo(13);
        }
        assertThat(held("ACCOUNT_WEEK", user)).isEqualByComparingTo("1.25");
        assertThat(count(user)).isEqualTo(13);
    }

    @Test void globalLimitAppliesAcrossAccountsAndAdmissionFailureRollsBackEarlierBuckets() {
        jdbc.update("UPDATE app.platform_spend_settings SET global_week_usd=.10 WHERE id=1");
        UUID first = UUID.randomUUID(), second = UUID.randomUUID();
        tx.executeWithoutResult(s -> spend.reserve(first, UUID.randomUUID(), LUNA));
        assertThatThrownBy(() -> tx.executeWithoutResult(s -> spend.reserve(second, UUID.randomUUID(), LUNA)))
            .isInstanceOf(PlatformSpendExhaustedException.class);
        assertThat(count(second)).isZero();
        assertThat(held("GLOBAL_DAY", new UUID(0, 0))).isEqualByComparingTo(".10");
    }

    @Test void replayIsIdempotentAndRefundResetOrDeletionCannotEraseMoney() {
        UUID user = UUID.randomUUID(), run = UUID.randomUUID();
        var original = tx.execute(s -> spend.reserve(user, run, LUNA));
        var replay = tx.execute(s -> spend.reserve(user, run, LUNA));
        assertThat(replay).isEqualTo(original);
        assertThat(count(user)).isOne();
        assertThat(held("ACCOUNT_WEEK", user)).isEqualByComparingTo(".10");
        // Credit resets/refunds touch their own tables; money has no credit epoch or cascading FK.
        jdbc.update("UPDATE app.weekly_credit_settings SET epoch=epoch+1 WHERE id=1");
        assertThat(held("ACCOUNT_WEEK", user)).isEqualByComparingTo(".10");
        assertThatThrownBy(() -> jdbc.update("DELETE FROM app.platform_spend_reservation WHERE run_id=?", run))
            .isInstanceOf(org.springframework.dao.DataAccessException.class);
    }

    @Test void refundedFailedRunsCannotRepeatedlyAvoidTheMonetaryAccountLimit() {
        UUID user = UUID.randomUUID();
        jdbc.update("INSERT INTO app.user_account(id, external_subject, email, status) VALUES (?, ?, ?, 'ACTIVE')",
            user, "spend-refund-test:" + user, user + "@example.invalid");
        for (int i = 0; i < 13; i++) {
            UUID run = UUID.randomUUID();
            tx.executeWithoutResult(s -> {
                credits.reserve(user, run, Provider.OPENAI, "gpt-5.6-luna");
                spend.reserve(user, run, LUNA);
            });
            tx.executeWithoutResult(s -> credits.settleConfirmed(run,
                com.freelanceops.backend.domain.agentrun.model.AgentRunStatus.FAILED));
        }
        assertThat(credits.current(user).used()).isZero();
        assertThat(credits.current(user).reserved()).isZero();
        assertThatThrownBy(() -> tx.executeWithoutResult(s -> {
            UUID run = UUID.randomUUID();
            credits.reserve(user, run, Provider.OPENAI, "gpt-5.6-luna");
            spend.reserve(user, run, LUNA);
        })).isInstanceOf(PlatformSpendExhaustedException.class);
        assertThat(credits.current(user).reserved()).isZero();
        assertThat(held("ACCOUNT_WEEK", user)).isEqualByComparingTo("1.25");
    }

    @Test void knownAndUnknownPlatformUsageSatisfyMigratedCostConstraintsWithoutMutablePricingSnapshot() {
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
        jdbc.update("INSERT INTO app.user_account(id,external_subject,email,status) VALUES (?,?,?,'ACTIVE')",
            user, "cost-schema-test:" + user, user + "@example.invalid");
        jdbc.update("INSERT INTO app.workspace(id,name,slug,status,created_by) VALUES (?,'Synthetic',?,'ACTIVE',?)",
            workspace, "spend-test-" + workspace, user);
        jdbc.update("INSERT INTO app.project(id,workspace_id,title,requirement_text,currency,created_by) VALUES (?,?,'Synthetic','Synthetic','USD',?)",
            project, workspace, user);
        for (boolean known : List.of(false, true)) {
            UUID runId = UUID.randomUUID();
            var now = java.time.Instant.now();
            var run = new com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity(runId, workspace, project,
                UUID.randomUUID(), user, Provider.OPENAI, "gpt-5.6-luna",
                com.freelanceops.backend.domain.agentrun.model.AgentRunStatus.FAILED, now);
            var call = new com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage(
                UUID.randomUUID(), Provider.OPENAI, "gpt-5.6-luna", "responses.create", 1000, 500, 0, 0,
                new BigDecimal(".01"), new BigDecimal(".01"), known, "PLATFORM");
            var usage = new com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.AgentRunUsage(
                com.freelanceops.backend.domain.agentrun.model.RequestTier.SINGLE_AGENT, 1, 0, 1000, 500, 0, 0, 0, 0, 1,
                List.of(call), new BigDecimal(".01"), runId, PlatformSpendService.TARIFF_VERSION);
            var view = new com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView(runId,
                com.freelanceops.backend.domain.agentrun.model.AgentRunStatus.FAILED, null, null, null, "SYNTHETIC", null, usage, now);
            tx.executeWithoutResult(s -> {
                spend.reserve(user, runId, LUNA);
                runs.saveAndFlush(run);
                costs.synchronize(run, view);
            });
            assertThat(jdbc.queryForObject("SELECT cost_status FROM app.agent_run_usage WHERE agent_run_id=?", String.class, runId))
                .isEqualTo(known ? "PRICED" : "UNPRICED");
            assertThat(jdbc.queryForObject("SELECT pricing_snapshot_id IS NULL AND cost_currency='USD' FROM app.agent_run_usage WHERE agent_run_id=?", Boolean.class, runId)).isTrue();
            assertThat(jdbc.queryForObject("SELECT actual_cost IS NULL FROM app.agent_run_usage WHERE agent_run_id=?", Boolean.class, runId))
                .isEqualTo(!known);
        }
    }

    @Test void outboxFailureRollsBackMonetaryAdmission() {
        UUID user = UUID.randomUUID();
        assertThatThrownBy(() -> tx.executeWithoutResult(s -> {
            spend.reserve(user, UUID.randomUUID(), LUNA);
            throw new IllegalStateException("synthetic outbox failure");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(count(user)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_bucket", Integer.class)).isZero();
    }

    private BigDecimal held(String scope, UUID subject) {
        return jdbc.queryForObject("SELECT held_usd FROM app.platform_spend_bucket WHERE scope=? AND subject_id=?",
            BigDecimal.class, scope, subject);
    }
    private int count(UUID user) {
        return jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_reservation WHERE user_id=?", Integer.class, user);
    }
}
