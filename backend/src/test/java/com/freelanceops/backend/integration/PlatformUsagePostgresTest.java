package com.freelanceops.backend.integration;

import static org.assertj.core.api.Assertions.*;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.*;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.service.*;

import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.data.domain.PageRequest;
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
import java.time.Instant;
import java.util.*;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(
        properties = {
            "app.environment=test",
            "platform.ai.spend.enabled=true",
            "agent.command-dispatch-enabled=false",
            "agent.reconciliation-enabled=false"
        })
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PlatformUsagePostgresTest {
    @Container
    static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer(
                    DockerImageName.parse("pgvector/pgvector:pg17")
                            .asCompatibleSubstituteFor("postgres"));

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.flyway.create-schemas", () -> true);
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformSpendService spend;
    @Autowired PlatformUsageService usage;
    @Autowired AgentRunProjectionService projection;
    @Autowired ProjectPetConversationService conversations;
    @Autowired AgentRunRepository runs;
    @Autowired PlatformTransactionManager manager;
    TransactionTemplate tx;
    UUID user, workspace, project;
    static final ModelSelection LUNA =
            new ModelSelection(Provider.OPENAI, "gpt-5.6-luna", ReasoningEffort.LOW);

    @BeforeEach
    void setup() {
        tx = new TransactionTemplate(manager);
        user = UUID.randomUUID();
        workspace = UUID.randomUUID();
        project = UUID.randomUUID();
        jdbc.execute(
                "TRUNCATE app.agent_run_usage, app.platform_external_tool_attempt, app.platform_provider_attempt, app.platform_spend_settlement, app.platform_spend_reservation, app.platform_spend_bucket");
        jdbc.update(
                "UPDATE app.platform_spend_settings SET account_week_usd=1.25,global_day_usd=25,global_week_usd=100 WHERE id=1");
        jdbc.update(
                "INSERT INTO app.user_account(id,external_subject,email,status) VALUES (?,?,?,'ACTIVE')",
                user,
                "usage-test:" + user,
                user + "@example.invalid");
        jdbc.update(
                "INSERT INTO app.workspace(id,name,slug,status,created_by) VALUES (?,'Synthetic',?,'ACTIVE',?)",
                workspace,
                "usage-test-" + workspace,
                user);
        jdbc.update(
                "INSERT INTO app.project(id,workspace_id,title,requirement_text,currency,created_by) VALUES (?,?,'Synthetic','Synthetic','USD',?)",
                project,
                workspace,
                user);
    }

    AgentRunEntity reserve(UUID credential) {
        var run =
                new AgentRunEntity(
                        UUID.randomUUID(),
                        workspace,
                        project,
                        UUID.randomUUID(),
                        user,
                        Provider.OPENAI,
                        LUNA.model(),
                        AgentRunStatus.RUNNING,
                        Instant.now());
        if (credential != null) run.useCredential(credential);
        tx.executeWithoutResult(
                s -> {
                    spend.reserve(user, run.id(), LUNA);
                    runs.saveAndFlush(run);
                });
        return run;
    }

    ProviderCallUsage call(UUID id, boolean known, String funding) {
        return new ProviderCallUsage(
                id,
                Provider.OPENAI,
                LUNA.model(),
                "responses.create",
                1000,
                500,
                0,
                0,
                new BigDecimal(".01"),
                "BYOK".equals(funding) ? BigDecimal.ZERO : new BigDecimal(".01"),
                known,
                funding);
    }

    AgentRunView view(
            AgentRunEntity run,
            List<ProviderCallUsage> calls,
            boolean closed,
            AgentRunStatus status,
            Instant at) {
        var report =
                new AgentRunView.AgentRunUsage(
                        RequestTier.SINGLE_AGENT,
                        calls.size(),
                        0,
                        1000 * calls.size(),
                        500 * calls.size(),
                        0,
                        0,
                        0,
                        0,
                        1,
                        calls,
                        BigDecimal.ZERO,
                        run.id(),
                        PlatformSpendTariff.VERSION,
                        closed);
        return new AgentRunView(run.id(), status, null, null, null, null, null, report, at);
    }

    void sync(
            AgentRunEntity run,
            List<ProviderCallUsage> calls,
            boolean closed,
            AgentRunStatus status,
            Instant at) {
        tx.executeWithoutResult(s -> usage.synchronize(run, view(run, calls, closed, status, at)));
    }

    @Test
    void partialConversationProjectionCommitsMessagesAndReleasesTheActiveRunGuard() {
        var run = reserve(null);
        conversations.recordStart(user, workspace, project, run.id(), "합성 예약 검토");
        var message = new AgentRunView.PetMessage(UUID.randomUUID(), null, null, null,
                "검토 후 정정: 중복 처리 확인이 필요합니다.", List.of(), List.of());
        var result = new AgentRunView.AgentRunResult("부분 검토", List.of(), List.of(), null,
                List.of(), List.of(), List.of(message));
        var partial = new AgentRunView(run.id(), AgentRunStatus.PARTIAL, null, null, result,
                "RUN_BUDGET_EXCEEDED", null,
                view(run, List.of(call(UUID.randomUUID(), true, "PLATFORM")), true,
                        AgentRunStatus.PARTIAL, Instant.now()).usage(), Instant.now());
        for (int replay = 0; replay < 2; replay++) {
            assertThat(projection.synchronize(run.id(), workspace, partial).status()).isEqualTo(AgentRunStatus.PARTIAL);
            assertThat(runs.findById(run.id()).orElseThrow().status()).isEqualTo(AgentRunStatus.PARTIAL);
            assertThat(runs.existsByWorkspaceIdAndProjectIdAndStatusIn(workspace, project,
                    List.of(AgentRunStatus.QUEUED, AgentRunStatus.RUNNING, AgentRunStatus.WAITING_FOR_USER))).isFalse();
            assertThat(jdbc.queryForObject("SELECT messages_json->0->>'text' FROM app.project_pet_turn WHERE run_id=?",
                    String.class, run.id())).isEqualTo(message.text());
            assertThat(usage.snapshot(user).settledUsd()).isEqualByComparingTo(".0008");
            assertThat(usage.snapshot(user).reservedUsd()).isZero();
        }
    }

    @ParameterizedTest
    @CsvSource({"platform-ai-2026-10-04-v1,false", "platform-ai-2026-10-05-v2,true", "platform-ai-2026-10-22-v3,true"})
    void terminalReservationsAwaitingClosureRemainEligibleForReconciliation(String version, boolean eligible) {
        var now = Instant.now();
        var run = new AgentRunEntity(UUID.randomUUID(), workspace, project, UUID.randomUUID(), user,
                Provider.OPENAI, LUNA.model(), AgentRunStatus.PARTIAL, now);
        run.scheduleReconciliation(now.minusSeconds(1));
        tx.executeWithoutResult(s -> {
            runs.saveAndFlush(run);
            jdbc.update("""
                INSERT INTO app.platform_spend_reservation(run_id,user_id,provider,model,max_cost_usd,tariff_version,
                    day_period,week_period,valid_until) VALUES (?,?,'OPENAI',?,.10,?,?,?,?)
                """, run.id(), user, LUNA.model(), version,
                java.sql.Date.valueOf(now.atZone(FreeUsageService.TIMEZONE).toLocalDate()),
                java.sql.Date.valueOf(FreeUsageService.Period.at(now).start()),
                java.sql.Timestamp.from(now.plusSeconds(60)));
            jdbc.update("INSERT INTO app.platform_spend_settlement(run_id,reserved_usd) VALUES (?,.10)", run.id());
        });
        assertThat(runs.findMonetaryRunsAwaitingClosure(now, PageRequest.of(0, 100)).stream()
                .anyMatch(value -> value.id().equals(run.id()))).isEqualTo(eligible);
        jdbc.update("UPDATE app.platform_spend_settlement SET execution_closed=true WHERE run_id=?", run.id());
        assertThat(runs.findMonetaryRunsAwaitingClosure(now, PageRequest.of(0, 100))).isEmpty();
    }

    @Test
    void externalSearchAttemptSharesTheCapAndDoesNotInflateModelCallCount() {
        var run = reserve(null);
        UUID id = UUID.randomUUID();
        Instant at = Instant.now();
        for (int step = 0; step < 3; step++) {
            boolean known = step > 0;
            var call = new AgentRunView.ExternalToolCallUsage(id, "TAVILY", "SEARCH_BASIC",
                    "tavily-basic-2026-10-22-v1", 1, new BigDecimal("0.008"), new BigDecimal("0.008"), known);
            var report = new AgentRunView.AgentRunUsage(RequestTier.SINGLE_AGENT, 0, 1, 0, 0, 0, 1, 0, 0, 1,
                    List.of(), new BigDecimal("0.008"), run.id(), PlatformSpendTariff.VERSION,
                    known, false, null, List.of(call));
            var view = new AgentRunView(run.id(), known ? AgentRunStatus.COMPLETED : AgentRunStatus.RUNNING,
                    null, null, null, null, null, report, at.plusSeconds(step));
            tx.executeWithoutResult(status -> usage.synchronize(run, view));
            if (!known) assertThat(usage.snapshot(user).reservedUsd()).isEqualByComparingTo(".10");
        }
        assertThat(usage.snapshot(user).settledUsd()).isEqualByComparingTo(".008");
        assertThat(usage.snapshot(user).reservedUsd()).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_external_tool_attempt WHERE run_id=?",
                Integer.class, run.id())).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_provider_attempt WHERE run_id=?",
                Integer.class, run.id())).isZero();
    }

    @Test
    void perAttemptSettlementIsIdempotentAndUnusedCapWaitsForClosedWorker() {
        var run = reserve(null);
        var id = UUID.randomUUID();
        Instant at = Instant.now();
        sync(run, List.of(call(id, false, "PLATFORM")), false, AgentRunStatus.RUNNING, at);
        assertThat(usage.snapshot(user).reservedUsd()).isEqualByComparingTo(".10");
        sync(
                run,
                List.of(call(id, true, "PLATFORM")),
                false,
                AgentRunStatus.CANCELLED,
                at.plusSeconds(1));
        assertThat(usage.snapshot(user).settledUsd()).isEqualByComparingTo(".0008");
        assertThat(usage.snapshot(user).reservedUsd()).isEqualByComparingTo(".0992");
        sync(
                run,
                List.of(call(id, true, "PLATFORM")),
                true,
                AgentRunStatus.CANCELLED,
                at.plusSeconds(2));
        sync(
                run,
                List.of(call(id, true, "PLATFORM")),
                true,
                AgentRunStatus.CANCELLED,
                at.plusSeconds(2));
        // 오래된 사용량 보고가 이미 정산한 예약을 되살리면 안 된다.
        sync(run, List.of(call(id, false, "PLATFORM")), false, AgentRunStatus.RUNNING, at);
        assertThat(usage.snapshot(user).reservedUsd()).isZero();
        assertThat(usage.snapshot(user).remainingUsd()).isEqualByComparingTo("1.2492");
        assertThat(usage.history(user, null, 20).items().getFirst().providerCalls()).hasSize(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT held_usd FROM app.platform_spend_bucket WHERE scope='ACCOUNT_WEEK' AND subject_id=?",
                                BigDecimal.class,
                                user))
                .isEqualByComparingTo(".0008");
    }

    @Test
    void unknownFailureRetainsOnlyConservativeAttemptBoundAfterClosure() {
        var run = reserve(null);
        var at = Instant.now();
        sync(
                run,
                List.of(
                        call(UUID.randomUUID(), true, "PLATFORM"),
                        call(UUID.randomUUID(), false, "PLATFORM")),
                true,
                AgentRunStatus.FAILED,
                at);
        var current = usage.snapshot(user);
        assertThat(current.settledUsd()).isEqualByComparingTo(".0008");
        assertThat(current.reservedUsd()).isEqualByComparingTo(".01");
        assertThat(usage.history(user, null, 20).items().getFirst().usageKnown()).isFalse();
    }

    @Test
    void freeWorkAndByokDoNotBecomePlatformChargesButRoutingDoes() {
        var empty = reserve(null);
        sync(empty, List.of(), true, AgentRunStatus.COMPLETED, Instant.now());
        assertThat(usage.snapshot(user).remainingUsd()).isEqualByComparingTo("1.25");
        var personal = reserve(UUID.randomUUID());
        sync(
                personal,
                List.of(
                        call(UUID.randomUUID(), true, "PLATFORM"),
                        call(UUID.randomUUID(), true, "BYOK")),
                true,
                AgentRunStatus.COMPLETED,
                Instant.now());
        assertThat(usage.snapshot(user).settledUsd()).isEqualByComparingTo(".0008");
        var entry = usage.history(user, null, 1).items().getFirst();
        assertThat(entry.byokInputTokens()).isEqualTo(1000);
        assertThat(entry.byokOutputTokens()).isEqualTo(500);
        assertThat(usage.history(UUID.randomUUID(), null, 20).items()).isEmpty();
    }

    @Test
    void priceCapChangesAndCreditResetCannotAlterAlreadyReservedAccounting() {
        var run = reserve(null);
        var at = Instant.now();
        jdbc.update(
                "UPDATE app.platform_spend_model_cap SET max_run_usd=.20 WHERE model='gpt-5.6-luna'");
        jdbc.update("UPDATE app.weekly_credit_settings SET epoch=epoch+1 WHERE id=1");
        var replay = tx.execute(s -> spend.reserve(user, run.id(), LUNA));
        assertThat(replay.maxCostUsd()).isEqualByComparingTo(".10");
        sync(
                run,
                List.of(call(UUID.randomUUID(), true, "PLATFORM")),
                true,
                AgentRunStatus.PARTIAL,
                at);
        assertThat(usage.snapshot(user).settledUsd()).isEqualByComparingTo(".0008");
        jdbc.update(
                "UPDATE app.platform_spend_model_cap SET max_run_usd=.10 WHERE model='gpt-5.6-luna'");
    }

    @Test
    void completedUsageRejectsChangedAndAdditionalAttemptIdentities() {
        var run = reserve(null);
        var id = UUID.randomUUID();
        var at = Instant.now();
        sync(run, List.of(call(id, true, "PLATFORM")), true, AgentRunStatus.COMPLETED, at);
        assertThatThrownBy(
                        () ->
                                sync(
                                        run,
                                        List.of(call(UUID.randomUUID(), true, "PLATFORM")),
                                        true,
                                        AgentRunStatus.COMPLETED,
                                        at.plusSeconds(1)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(usage.snapshot(user).settledUsd()).isEqualByComparingTo(".0008");
    }

    @Test
    void lateKnownUsageSettlesClosedUnknownAttemptExactlyOnce() {
        var run = reserve(null);
        var id = UUID.randomUUID();
        var at = Instant.now();
        sync(run, List.of(call(id, false, "PLATFORM")), true, AgentRunStatus.FAILED, at);
        assertThat(usage.snapshot(user).reservedUsd()).isEqualByComparingTo(".01");
        sync(
                run,
                List.of(call(id, true, "PLATFORM")),
                true,
                AgentRunStatus.FAILED,
                at.plusSeconds(1));
        sync(
                run,
                List.of(call(id, true, "PLATFORM")),
                true,
                AgentRunStatus.FAILED,
                at.plusSeconds(1));
        assertThat(usage.snapshot(user).settledUsd()).isEqualByComparingTo(".0008");
        assertThat(usage.snapshot(user).reservedUsd()).isZero();
        assertThat(usage.snapshot(user).remainingUsd()).isEqualByComparingTo("1.2492");
        assertThat(usage.history(user, null, 20).items().getFirst().usageKnown()).isTrue();
        assertThat(
                        jdbc.queryForList(
                                "SELECT held_usd FROM app.platform_spend_bucket", BigDecimal.class))
                .hasSize(3)
                .allSatisfy(value -> assertThat(value).isEqualByComparingTo(".0008"));
    }

    @Test
    void conflictingAttemptRollsBackEarlierAttemptWritesAndAllowsCleanRetry() {
        var first = reserve(null);
        var second = reserve(null);
        var shared = UUID.randomUUID();
        var fresh = UUID.randomUUID();
        var at = Instant.now();
        sync(first, List.of(call(shared, true, "PLATFORM")), true, AgentRunStatus.COMPLETED, at);
        assertThatThrownBy(
                        () ->
                                sync(
                                        second,
                                        List.of(
                                                call(fresh, true, "PLATFORM"),
                                                call(shared, true, "PLATFORM")),
                                        true,
                                        AgentRunStatus.COMPLETED,
                                        at.plusSeconds(1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Attempt belongs to another run");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM app.platform_provider_attempt WHERE run_id=?",
                                Integer.class,
                                second.id()))
                .isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT execution_closed FROM app.platform_spend_settlement WHERE run_id=?",
                                Boolean.class,
                                second.id()))
                .isFalse();
        assertThat(usage.snapshot(user).settledUsd()).isEqualByComparingTo(".0008");
        assertThat(usage.snapshot(user).reservedUsd()).isEqualByComparingTo(".10");
        sync(
                second,
                List.of(call(fresh, true, "PLATFORM")),
                true,
                AgentRunStatus.COMPLETED,
                at.plusSeconds(2));
        assertThat(usage.snapshot(user).settledUsd()).isEqualByComparingTo(".0016");
        assertThat(usage.snapshot(user).reservedUsd()).isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM app.platform_provider_attempt",
                                Integer.class))
                .isEqualTo(2);
    }

    @Test
    void inconsistentBucketRollsBackSettlementAndPreviouslyAdjustedBuckets() {
        var run = reserve(null);
        var id = UUID.randomUUID();
        var at = Instant.now();
        var accountPeriod =
                jdbc.queryForObject(
                        "SELECT period FROM app.platform_spend_bucket WHERE scope='ACCOUNT_WEEK' AND subject_id=?",
                        java.sql.Date.class,
                        user);
        jdbc.update(
                "DELETE FROM app.platform_spend_bucket WHERE scope='ACCOUNT_WEEK' AND subject_id=?",
                user);
        assertThatThrownBy(
                        () ->
                                sync(
                                        run,
                                        List.of(call(id, true, "PLATFORM")),
                                        true,
                                        AgentRunStatus.COMPLETED,
                                        at))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Monetary bucket is inconsistent");
        assertThat(
                        jdbc.queryForList(
                                "SELECT held_usd FROM app.platform_spend_bucket", BigDecimal.class))
                .hasSize(2)
                .allSatisfy(value -> assertThat(value).isEqualByComparingTo(".10"));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM app.platform_provider_attempt WHERE run_id=?",
                                Integer.class,
                                run.id()))
                .isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT execution_closed FROM app.platform_spend_settlement WHERE run_id=?",
                                Boolean.class,
                                run.id()))
                .isFalse();
        assertThat(usage.snapshot(user).reservedUsd()).isEqualByComparingTo(".10");
        jdbc.update(
                "INSERT INTO app.platform_spend_bucket(scope,subject_id,period,held_usd) VALUES ('ACCOUNT_WEEK',?,?,.10)",
                user,
                accountPeriod);
        sync(run, List.of(call(id, true, "PLATFORM")), true, AgentRunStatus.COMPLETED, at);
        assertThat(usage.snapshot(user).settledUsd()).isEqualByComparingTo(".0008");
        assertThat(usage.snapshot(user).reservedUsd()).isZero();
    }

    @Test
    void catalogueDoesNotClaimProviderAccessOrEnableDisabledSpending() {
        assertThat(usage.snapshot(user).models()).hasSize(7);
        var disabled =
                new PlatformUsageService(jdbc, new tools.jackson.databind.ObjectMapper(), false);
        assertThat(disabled.snapshot(user).models())
                .allSatisfy(
                        model -> {
                            assertThat(model.catalogued()).isTrue();
                            assertThat(model.available()).isFalse();
                            assertThat(model.unavailableReason()).isEqualTo("SPENDING_DISABLED");
                        });
    }

    @Test
    void previousWeekSettlementNeverReplenishesCurrentWeekAndHistoryPaginates() {
        var now = Instant.now();
        var oldDay = now.atZone(FreeUsageService.TIMEZONE).toLocalDate().minusWeeks(1);
        var oldWeek = FreeUsageService.Period.at(now.minusSeconds(7 * 86400)).start();
        var run =
                new AgentRunEntity(
                        UUID.randomUUID(),
                        workspace,
                        project,
                        UUID.randomUUID(),
                        user,
                        Provider.OPENAI,
                        LUNA.model(),
                        AgentRunStatus.RUNNING,
                        now);
        tx.executeWithoutResult(
                s -> {
                    jdbc.update(
                            """
                INSERT INTO app.platform_spend_reservation(run_id,user_id,provider,model,max_cost_usd,tariff_version,day_period,week_period,valid_until)
                VALUES (?,?,'OPENAI',?,.10,?,?,?,?)
                """,
                            run.id(),
                            user,
                            LUNA.model(),
                            PlatformSpendTariff.VERSION,
                            java.sql.Date.valueOf(oldDay),
                            java.sql.Date.valueOf(oldWeek),
                            java.sql.Timestamp.from(now.minusSeconds(86400)));
                    jdbc.update(
                            "INSERT INTO app.platform_spend_settlement(run_id,reserved_usd) VALUES (?,.10)",
                            run.id());
                    jdbc.update(
                            "INSERT INTO app.platform_spend_bucket VALUES ('ACCOUNT_WEEK',?,?,.10)",
                            user,
                            java.sql.Date.valueOf(oldWeek));
                    jdbc.update(
                            "INSERT INTO app.platform_spend_bucket VALUES ('GLOBAL_WEEK',?,?,.10)",
                            new UUID(0, 0),
                            java.sql.Date.valueOf(oldWeek));
                    jdbc.update(
                            "INSERT INTO app.platform_spend_bucket VALUES ('GLOBAL_DAY',?,?,.10)",
                            new UUID(0, 0),
                            java.sql.Date.valueOf(oldDay));
                    runs.saveAndFlush(run);
                });
        var current = reserve(null);
        sync(
                run,
                List.of(call(UUID.randomUUID(), true, "PLATFORM")),
                true,
                AgentRunStatus.COMPLETED,
                now);
        assertThat(usage.snapshot(user).remainingUsd()).isEqualByComparingTo("1.15");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT held_usd FROM app.platform_spend_bucket WHERE scope='ACCOUNT_WEEK' AND subject_id=? AND period=?",
                                BigDecimal.class,
                                user,
                                java.sql.Date.valueOf(oldWeek)))
                .isEqualByComparingTo(".0008");
        var page = usage.history(user, null, 1);
        assertThat(page.nextCursor()).isNotNull();
        var next = usage.history(user, page.nextCursor(), 1);
        assertThat(next.items()).hasSize(1);
        assertThat(next.items().getFirst().runId()).isNotEqualTo(page.items().getFirst().runId());
        sync(current, List.of(), true, AgentRunStatus.COMPLETED, now.plusSeconds(1));
        assertThat(usage.snapshot(user).remainingUsd()).isEqualByComparingTo("1.25");
    }
}
