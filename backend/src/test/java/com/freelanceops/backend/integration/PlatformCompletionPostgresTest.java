package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.PlatformBudget;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.ProviderCallUsage;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agentrun.model.RequestTier;
import com.freelanceops.backend.domain.agentrun.service.AgentBudgetPolicy;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendExhaustedException;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendService;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendTariff;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendUnavailableException;
import com.freelanceops.backend.domain.agentrun.service.PlatformUsageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
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
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.*;

/** Real database locks and deferred triggers; synthetic disposable data, no provider calls. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {"app.environment=test", "platform.ai.spend.enabled=true",
    "platform.ai.spend.completion-enabled=true", "agent.command-dispatch-enabled=false",
    "agent.reconciliation-enabled=false", "agent.quota.max-model-calls=4",
    "agent.quota.max-input-tokens=2000", "agent.quota.max-output-tokens=2000"})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Timeout(60)
class PlatformCompletionPostgresTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));

    @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.flyway.create-schemas", () -> true);
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    private static final UUID GLOBAL = new UUID(0, 0);
    private static final ZoneId KOREA = ZoneId.of("Asia/Seoul");
    private static final ModelSelection LUNA = new ModelSelection(Provider.OPENAI, "gpt-5.6-luna", ReasoningEffort.LOW);
    private static final RunBudget BUDGET = new RunBudget(90, 4, 3, 2000, 2000, 2, 1, 1, 2, 1);
    private static final BigDecimal FULL = new BigDecimal(".00290003");
    private static final JsonMapper MAPPER = JsonMapper.builder().findAndAddModules().build();
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformSpendService spend;
    @Autowired PlatformUsageService usage;
    @Autowired AgentBudgetPolicy budgetPolicy;
    @Autowired PlatformTransactionManager manager;
    private TransactionTemplate tx;
    private LocalDate today;
    private LocalDate month;

    @BeforeEach void setup() {
        tx = new TransactionTemplate(manager);
        // All cleanup and limit changes target this class's disposable Testcontainer only.
        jdbc.execute("TRUNCATE app.agent_run_usage, app.platform_provider_attempt, app.platform_spend_settlement, "
            + "app.platform_completion_reservation, app.platform_spend_month_entry, app.platform_spend_reservation, "
            + "app.platform_spend_bucket");
        jdbc.update("""
            UPDATE app.platform_spend_settings SET completion_required=TRUE,
                completion_router_models=ARRAY['gpt-5.6-luna']::text[],
                account_week_usd=?,global_day_usd=?,global_week_usd=?,
                global_month_soft_usd=?,global_month_hard_usd=? WHERE id=1
            """, multiple(100), multiple(200), multiple(300), multiple(400), multiple(500));
        jdbc.update("UPDATE app.platform_spend_model_cap SET max_run_usd=?,enabled=TRUE", multiple(10));
        today = jdbc.queryForObject("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date", Date.class).toLocalDate();
        month = today.withDayOfMonth(1);
    }

    @Test void fullAmountAndImmutableCompletionAreCommittedTogether() {
        UUID user = UUID.randomUUID(), run = UUID.randomUUID();
        var reserved = reserve(user, run);
        assertThat(reserved.maxCostUsd()).isEqualByComparingTo(FULL);
        assertThat(reserved.completion().protocolVersion()).isEqualTo("completion-v1");
        assertThat(reserved.completion().allowedModels()).containsExactly(LUNA.model());
        assertThat(reserved.completion().budget()).isEqualTo(BUDGET);
        assertThat(reserved.completion().policyRevision()).isEqualTo(revision());
        assertThat(jdbc.queryForList("SELECT held_usd FROM app.platform_spend_bucket", BigDecimal.class))
            .hasSize(3).allSatisfy(value -> assertThat(value).isEqualByComparingTo(FULL));
        assertThat(monthExposure()).isEqualByComparingTo(FULL);
        assertThat(count("platform_completion_reservation")).isOne();
        assertThatThrownBy(() -> jdbc.update("UPDATE app.platform_completion_reservation SET payload='{}'::jsonb WHERE run_id=?", run))
            .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM app.platform_completion_reservation WHERE run_id=?", run))
            .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE app.platform_spend_reservation SET max_cost_usd=1 WHERE run_id=?", run))
            .isInstanceOf(DataAccessException.class);
        assertThat(reserve(user, run)).isEqualTo(reserved);
    }

    @Test void migrationDefaultsRequireExplicitDatabaseActivationAndOperatorLimits() {
        assertThat(jdbc.queryForObject("""
            SELECT column_default FROM information_schema.columns
            WHERE table_schema='app' AND table_name='platform_spend_settings' AND column_name='completion_required'
            """, String.class)).isEqualTo("false");
        assertThat(jdbc.queryForList("""
            SELECT column_default FROM information_schema.columns
            WHERE table_schema='app' AND table_name='platform_spend_settings'
                AND column_name IN ('global_month_soft_usd','global_month_hard_usd')
            """, String.class)).hasSize(2).allSatisfy(value -> assertThat(value).isEqualTo("0"));
    }

    @Test void manyAccountsAndIndependentInstancesSerializeTheSoftTarget() throws Exception {
        monthly(FULL.multiply(new BigDecimal("2.5")), multiple(4));
        assertThat(raceAdmissions(18)).isEqualTo(3);
        assertThat(monthExposure()).isEqualByComparingTo(multiple(3));
        assertThat(count("platform_spend_reservation")).isEqualTo(3);
        assertThat(count("platform_completion_reservation")).isEqualTo(3);
        assertThat(held("GLOBAL_DAY", GLOBAL, today)).isEqualByComparingTo(multiple(3));
        assertThat(held("GLOBAL_WEEK", GLOBAL, week(today))).isEqualByComparingTo(multiple(3));
        assertThatThrownBy(() -> reserve(UUID.randomUUID(), UUID.randomUUID()))
            .isInstanceOf(PlatformSpendExhaustedException.class).hasMessageContaining("GLOBAL_MONTH_SOFT_TARGET");
    }

    @Test void manyAccountsAndIndependentInstancesCannotClipTheHardRemainder() throws Exception {
        monthly(FULL.multiply(new BigDecimal("2.5")), FULL.multiply(new BigDecimal("2.5")));
        assertThat(raceAdmissions(18)).isEqualTo(2);
        assertThat(monthExposure()).isEqualByComparingTo(multiple(2));
        assertThat(jdbc.queryForList("SELECT max_cost_usd FROM app.platform_spend_reservation", BigDecimal.class))
            .hasSize(2).allSatisfy(value -> assertThat(value).isEqualByComparingTo(FULL));
        assertThatThrownBy(() -> reserve(UUID.randomUUID(), UUID.randomUUID()))
            .isInstanceOf(PlatformSpendExhaustedException.class).hasMessageContaining("GLOBAL_MONTH_HARD_LIMIT");
        assertThat(count("platform_spend_bucket")).isEqualTo(4);
    }

    @ParameterizedTest
    @ValueSource(strings = {"account_week_usd", "global_day_usd", "global_week_usd"})
    void insufficientExistingCapRollsBackEveryAdmissionWrite(String column) {
        jdbc.update("UPDATE app.platform_spend_settings SET " + column + "=? WHERE id=1", FULL.subtract(new BigDecimal(".00000001")));
        assertThatThrownBy(() -> reserve(UUID.randomUUID(), UUID.randomUUID())).isInstanceOf(PlatformSpendExhaustedException.class);
        assertEmptyAdmission();
    }

    @Test void legacyPathAlsoRejectsInsteadOfClippingTheAvailableRemainder() {
        jdbc.update("UPDATE app.platform_spend_settings SET completion_required=FALSE,account_week_usd=? WHERE id=1", multiple(9));
        assertThatThrownBy(() -> reserve(UUID.randomUUID(), UUID.randomUUID()))
            .isInstanceOf(PlatformSpendExhaustedException.class).hasMessageContaining("ACCOUNT_WEEK");
        assertEmptyAdmission();
    }

    @Test void simulatedOutboxFailureRollsBackParentChildMonthSettlementAndAllBuckets() {
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
            spend.reserve(UUID.randomUUID(), UUID.randomUUID(), LUNA, BUDGET);
            assertThat(count("platform_completion_reservation")).isOne();
            assertThat(monthExposure()).isEqualByComparingTo(FULL);
            throw new IllegalStateException("synthetic dispatch outbox failure");
        })).isInstanceOf(IllegalStateException.class).hasMessage("synthetic dispatch outbox failure");
        assertEmptyAdmission();
    }

    @Test void actualOutboxConstraintFailureRollsBackCompletionAdmission() {
        UUID user = UUID.randomUUID(), run = UUID.randomUUID();
        jdbc.update("INSERT INTO app.user_account(id,external_subject,email,status) VALUES (?,?,?,'ACTIVE')",
            user, "completion-outbox:" + user, user + "@example.invalid");
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
            spend.reserve(user, run, LUNA, BUDGET);
            // No agent_run row was created: the real outbox foreign key rejects dispatch.
            jdbc.update("""
                INSERT INTO app.agent_run_command(id,run_id,command_type,payload,requested_by,effective_permissions,status)
                VALUES (?,?,'START','{}',?,'[]','PENDING')
                """, UUID.randomUUID(), run, user);
        })).isInstanceOf(DataAccessException.class).hasStackTraceContaining("agent_run_command_run_id_fkey");
        assertEmptyAdmission();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.agent_run_command WHERE run_id=?", Integer.class, run)).isZero();
    }

    @Test void replayPinsPolicyRevisionModelsBudgetAmountAndDeadlineAcrossPolicyChanges() {
        UUID user = UUID.randomUUID(), run = UUID.randomUUID();
        var original = reserve(user, run);
        String parent = jdbc.queryForObject("SELECT row_to_json(r)::text FROM app.platform_spend_reservation r WHERE run_id=?", String.class, run);
        String child = jdbc.queryForObject("SELECT payload::text FROM app.platform_completion_reservation WHERE run_id=?", String.class, run);
        long originalRevision = revision();
        jdbc.update("UPDATE app.platform_spend_settings SET completion_router_models=ARRAY['gpt-6-luna']::text[] WHERE id=1");
        assertThat(revision()).isEqualTo(originalRevision + 1);
        jdbc.update("UPDATE app.platform_spend_settings SET account_week_usd=account_week_usd+? WHERE id=1", FULL);
        assertThat(revision()).isEqualTo(originalRevision + 1);
        jdbc.update("UPDATE app.platform_spend_model_cap SET max_run_usd=? WHERE model=?", FULL.divide(BigDecimal.valueOf(2)), LUNA.model());
        var oldInstance = new PlatformSpendService(jdbc, true, false);
        PlatformBudget replay = tx.execute(status -> oldInstance.reserve(user, run, LUNA, BUDGET));
        assertThat(replay).isEqualTo(original);
        assertThat(jdbc.queryForObject("SELECT row_to_json(r)::text FROM app.platform_spend_reservation r WHERE run_id=?", String.class, run)).isEqualTo(parent);
        assertThat(jdbc.queryForObject("SELECT payload::text FROM app.platform_completion_reservation WHERE run_id=?", String.class, run)).isEqualTo(child);
        assertThat(count("platform_spend_reservation")).isOne();
        assertThat(monthExposure()).isEqualByComparingTo(FULL);
        jdbc.update("UPDATE app.platform_spend_model_cap SET max_run_usd=? WHERE model=?", multiple(10), LUNA.model());
        var fresh = reserve(user, UUID.randomUUID());
        assertThat(fresh.completion().policyRevision()).isEqualTo(originalRevision + 1);
        assertThat(fresh.completion().allowedModels()).containsExactly("gpt-5.6-luna", "gpt-6-luna");
        assertThat(reserve(user, run)).isEqualTo(original);
    }

    @Test void reusedRunWithDifferentFullBudgetOrAccountConflictsWithoutChangingOriginal() {
        UUID user = UUID.randomUUID(), run = UUID.randomUUID();
        var original = reserve(user, run);
        var changed = new RunBudget(91, 4, 3, 2000, 2000, 2, 1, 1, 2, 1);
        assertThatThrownBy(() -> tx.execute(status -> spend.reserve(user, run, LUNA, changed)))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(409));
        assertThatThrownBy(() -> reserve(UUID.randomUUID(), run))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(409));
        assertThat(reserve(user, run)).isEqualTo(original);
        assertThat(monthExposure()).isEqualByComparingTo(FULL);
    }

    @Test void expensiveRouterIsIncludedBeforeTestingSelectedModelCap() {
        jdbc.update("UPDATE app.platform_spend_settings SET completion_router_models=ARRAY['gpt-6-astra']::text[] WHERE id=1");
        assertThat(PlatformSpendTariff.fullReservation(List.of(LUNA.model(), "gpt-6-astra"), BUDGET,
            PlatformSpendTariff.VERSION)).isEqualByComparingTo(".12500003");
        assertThatThrownBy(() -> reserve(UUID.randomUUID(), UUID.randomUUID()))
            .isInstanceOf(PlatformSpendExhaustedException.class).hasMessageContaining("MODEL_FULL_RESERVATION");
        assertEmptyAdmission();
        assertThat(model(usage.snapshot(UUID.randomUUID()), LUNA.model()).unavailableReason()).isEqualTo("MODEL_FULL_RESERVATION");
    }

    @Test void selectedModelCapBelowTheFullBoundCannotBecomeAPartialReservation() {
        jdbc.update("UPDATE app.platform_spend_model_cap SET max_run_usd=? WHERE model=?",
            FULL.subtract(new BigDecimal(".00000001")), LUNA.model());
        assertThatThrownBy(() -> reserve(UUID.randomUUID(), UUID.randomUUID()))
            .isInstanceOf(PlatformSpendExhaustedException.class).hasMessageContaining("MODEL_FULL_RESERVATION");
        assertEmptyAdmission();
        assertThat(model(usage.snapshot(UUID.randomUUID()), LUNA.model()).available()).isFalse();
    }

    @Test void unpriceableRouterFailsClosedBeforeAnyAdmissionState() {
        jdbc.update("UPDATE app.platform_spend_settings SET completion_router_models=ARRAY['unpriced-router']::text[] WHERE id=1");
        assertThatThrownBy(() -> reserve(UUID.randomUUID(), UUID.randomUUID())).isInstanceOf(ResponseStatusException.class);
        assertEmptyAdmission();
        assertThat(model(usage.snapshot(UUID.randomUUID()), LUNA.model()).unavailableReason()).isEqualTo("COMPLETION_POLICY_UNPRICEABLE");
    }

    @Test void positiveAccountRemainderBelowTheFullRequirementIsUnavailableInSnapshotAndAdmission() {
        UUID user = UUID.randomUUID();
        jdbc.update("UPDATE app.platform_spend_settings SET account_week_usd=? WHERE id=1", FULL.multiply(new BigDecimal("1.5")));
        reserve(user, UUID.randomUUID());
        var snapshot = usage.snapshot(user);
        assertThat(snapshot.remainingUsd()).isPositive().isLessThan(FULL);
        assertThat(model(snapshot, LUNA.model()).available()).isFalse();
        assertThat(model(snapshot, LUNA.model()).unavailableReason()).isEqualTo("ACCOUNT_BUDGET_EXHAUSTED");
        assertThatThrownBy(() -> reserve(user, UUID.randomUUID()))
            .isInstanceOf(PlatformSpendExhaustedException.class).hasMessageContaining("ACCOUNT_WEEK");
        assertThat(count("platform_spend_reservation")).isOne();
        assertThat(monthExposure()).isEqualByComparingTo(FULL);
    }

    @ParameterizedTest
    @ValueSource(strings = {"global_day_usd", "global_week_usd"})
    void positiveGlobalRemainderBelowTheFullRequirementIsUnavailableAcrossAccounts(String column) {
        jdbc.update("UPDATE app.platform_spend_settings SET " + column + "=? WHERE id=1", FULL.multiply(new BigDecimal("1.5")));
        reserve(UUID.randomUUID(), UUID.randomUUID());
        UUID second = UUID.randomUUID();
        var snapshot = usage.snapshot(second);
        assertThat(snapshot.remainingUsd()).isGreaterThan(FULL);
        assertThat(model(snapshot, LUNA.model()).available()).isFalse();
        assertThat(model(snapshot, LUNA.model()).unavailableReason()).isEqualTo("GLOBAL_BUDGET_EXHAUSTED");
        assertThatThrownBy(() -> reserve(second, UUID.randomUUID())).isInstanceOf(PlatformSpendExhaustedException.class);
        assertThat(count("platform_spend_reservation")).isOne();
        assertThat(monthExposure()).isEqualByComparingTo(FULL);
    }

    @Test void databaseActivationWithZeroMonthlyPolicyIsNotLocallyOverridden() {
        monthly(BigDecimal.ZERO, BigDecimal.ZERO);
        assertThatThrownBy(() -> reserve(UUID.randomUUID(), UUID.randomUUID()))
            .isInstanceOf(PlatformSpendExhaustedException.class).hasMessageContaining("MONTHLY_POLICY_UNCONFIGURED");
        assertEmptyAdmission();
        assertThat(model(usage.snapshot(UUID.randomUUID()), LUNA.model()).unavailableReason()).isEqualTo("MONTHLY_POLICY_UNCONFIGURED");
    }

    @Test void databaseActivationBlocksAnInstanceWhoseCompletionProtocolIsNotReady() {
        var oldInstance = new PlatformSpendService(jdbc, true, false);
        assertThatThrownBy(() -> tx.execute(status -> oldInstance.reserve(UUID.randomUUID(), UUID.randomUUID(), LUNA, BUDGET)))
            .isInstanceOf(PlatformSpendUnavailableException.class);
        assertEmptyAdmission();
        var oldUsage = new PlatformUsageService(jdbc, MAPPER, true, false, budgetPolicy);
        String unavailable = tx.execute(status -> model(oldUsage.snapshot(UUID.randomUUID()), LUNA.model()).unavailableReason());
        assertThat(unavailable).isEqualTo("COMPLETION_PROTOCOL_UNAVAILABLE");
    }

    @Test void locallyReadyInstanceStillUsesLegacyWireWhenDatabasePolicyIsInactive() {
        jdbc.update("UPDATE app.platform_spend_settings SET completion_required=FALSE,global_month_soft_usd=0,global_month_hard_usd=0 WHERE id=1");
        var reserved = reserve(UUID.randomUUID(), UUID.randomUUID());
        assertThat(reserved.maxCostUsd()).isEqualByComparingTo(multiple(10));
        assertThat(reserved.completion()).isNull();
        assertThat(MAPPER.readTree(MAPPER.writeValueAsString(reserved)).has("completion")).isFalse();
        assertThat(count("platform_completion_reservation")).isZero();
    }

    @Test void oldBinaryParentAndSettlementWithoutChildRollBackAtCommit() {
        UUID run = UUID.randomUUID();
        var reachedEndOfTransaction = new AtomicBoolean();
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
            rawParent(run, UUID.randomUUID(), today, FULL);
            jdbc.update("INSERT INTO app.platform_spend_settlement(run_id,reserved_usd) VALUES (?,?)", run, FULL);
            assertThat(count("platform_spend_reservation")).isOne();
            assertThat(count("platform_spend_month_entry")).isOne();
            reachedEndOfTransaction.set(true);
        })).isInstanceOf(RuntimeException.class).hasStackTraceContaining("Completion reservation protocol is required");
        assertThat(reachedEndOfTransaction).isTrue();
        assertEmptyAdmission();
    }

    @Test void sameMonthClosedKnownSettlementReleasesUnusedCapacityAndStaleReportsCannotRestoreIt() {
        UUID user = UUID.randomUUID(), runId = UUID.randomUUID(), callId = UUID.randomUUID();
        reserve(user, runId);
        var run = entity(runId, user);
        var at = Instant.now();
        sync(run, List.of(call(callId, true, ".0017")), true, AgentRunStatus.COMPLETED, at);
        assertThat(monthExposure()).isEqualByComparingTo(".0008");
        assertThat(held("GLOBAL_DAY", GLOBAL, today)).isEqualByComparingTo(".0008");
        sync(run, List.of(call(callId, false, ".0017")), false, AgentRunStatus.RUNNING, at.minusSeconds(1));
        assertThat(monthExposure()).isEqualByComparingTo(".0008");
        monthly(FULL, multiple(2));
        reserve(UUID.randomUUID(), UUID.randomUUID());
        assertThat(monthExposure()).isEqualByComparingTo(FULL.add(new BigDecimal(".0008")));
    }

    @Test void previousMonthWaitingRunCarriesWholeEnvelopeAndClosureCannotRefundCurrentMonth() {
        UUID user = UUID.randomUUID();
        var run = historical(user, month.minusDays(1), ".017", "0", ".017", false);
        usage.snapshot(user); // First current-month observation carries the old open envelope.
        assertThat(monthExposure()).isEqualByComparingTo(".017");
        assertThat(carried(run.id())).isTrue();
        var at = Instant.now();
        UUID callId = UUID.randomUUID();
        sync(run, List.of(call(callId, true, ".0017")), true, AgentRunStatus.WAITING_FOR_USER, at);
        assertThat(jdbc.queryForObject("SELECT execution_closed FROM app.platform_spend_settlement WHERE run_id=?", Boolean.class, run.id())).isFalse();
        sync(run, List.of(call(callId, true, ".0017")), true, AgentRunStatus.COMPLETED, at.plusSeconds(1));
        sync(run, List.of(call(callId, false, ".0017")), false, AgentRunStatus.RUNNING, at.minusSeconds(1));
        usage.snapshot(user);
        assertThat(monthExposure()).isEqualByComparingTo(".017");
        assertThat(held("GLOBAL_DAY", GLOBAL, month.minusDays(1))).isEqualByComparingTo(".0008");
    }

    @Test void closedUnknownPriorMonthCarriesOnlyUnresolvedLiabilityAndLateKnownSettlementCannotRefundIt() {
        UUID user = UUID.randomUUID(), callId = UUID.randomUUID();
        var run = historical(user, month.minusMonths(1).withDayOfMonth(3), ".017", ".0008", ".0017", true);
        var knownCall = call(UUID.randomUUID(), true, ".0017");
        jdbc.update("INSERT INTO app.platform_provider_attempt(call_id,run_id,payload) VALUES (?,?,?::jsonb)",
            knownCall.callId(), run.id(), MAPPER.writeValueAsString(knownCall));
        jdbc.update("INSERT INTO app.platform_provider_attempt(call_id,run_id,payload) VALUES (?,?,?::jsonb)",
            callId, run.id(), MAPPER.writeValueAsString(call(callId, false, ".0017")));
        usage.snapshot(user);
        assertThat(monthExposure()).isEqualByComparingTo(".0017");
        sync(run, List.of(call(callId, true, ".0017")), true, AgentRunStatus.FAILED, Instant.now());
        usage.snapshot(user);
        assertThat(monthExposure()).isEqualByComparingTo(".0017");
        assertThat(jdbc.queryForObject("SELECT reserved_usd FROM app.platform_spend_settlement WHERE run_id=?", BigDecimal.class, run.id())).isZero();
    }

    @Test void oldStyleSettlementBeforeAnyAdmissionCapturesCarryBeforeReleasingItsOldPeriod() {
        var run = historical(UUID.randomUUID(), month.minusDays(1), ".017", "0", ".017", false);
        assertThat(count("platform_spend_month_entry")).isZero();
        assertThat(count("platform_completion_reservation")).isZero();
        // Old binaries write only their original settlement table. V49 must capture OLD liability.
        jdbc.update("UPDATE app.platform_spend_settlement SET settled_usd=.0008,reserved_usd=0,execution_closed=TRUE WHERE run_id=?", run.id());
        assertThat(monthExposure()).isEqualByComparingTo(".017");
        monthly(new BigDecimal(".016"), new BigDecimal(".020"));
        assertThatThrownBy(() -> reserve(UUID.randomUUID(), UUID.randomUUID()))
            .isInstanceOf(PlatformSpendExhaustedException.class).hasMessageContaining("GLOBAL_MONTH_SOFT_TARGET");
        assertThat(count("platform_spend_reservation")).isOne();
        assertThat(monthExposure()).isEqualByComparingTo(".017");
    }

    @Test void oldClosedUnknownSettledBeforeFirstAdmissionAlsoKeepsItsCarry() {
        var run = historical(UUID.randomUUID(), month.minusDays(1), ".017", ".0008", ".0017", true);
        assertThat(count("platform_spend_month_entry")).isZero();
        jdbc.update("UPDATE app.platform_spend_settlement SET settled_usd=.0016,reserved_usd=0 WHERE run_id=?", run.id());
        assertThat(monthExposure()).isEqualByComparingTo(".0017");
        usage.snapshot(UUID.randomUUID());
        assertThat(monthExposure()).isEqualByComparingTo(".0017");
    }

    @Test void excessiveObservedUsageRemainsVisibleAndBlocksNewAdmissions() {
        UUID user = UUID.randomUUID(), runId = UUID.randomUUID();
        reserve(user, runId);
        var expensive = new ProviderCallUsage(UUID.randomUUID(), Provider.OPENAI, LUNA.model(), "responses.create",
            1000, 500, 0, 0, BigDecimal.ZERO, multiple(7), false, "PLATFORM");
        sync(entity(runId, user), List.of(expensive), true, AgentRunStatus.FAILED, Instant.now());
        assertThat(monthExposure()).isEqualByComparingTo(multiple(7));
        monthly(multiple(6), multiple(8));
        assertThatThrownBy(() -> reserve(UUID.randomUUID(), UUID.randomUUID()))
            .isInstanceOf(PlatformSpendExhaustedException.class).hasMessageContaining("GLOBAL_MONTH_SOFT_TARGET");
        assertThat(model(usage.snapshot(UUID.randomUUID()), LUNA.model()).unavailableReason()).isEqualTo("GLOBAL_MONTH_SOFT_TARGET");
        assertThat(count("platform_spend_reservation")).isOne();
    }

    @Test void priorMonthIncreasedExposureIsAddedConservativelyAndNeverReducedByLaterRelease() {
        var run = historical(UUID.randomUUID(), month.minusDays(1), ".017", "0", ".017", false);
        jdbc.update("UPDATE app.platform_spend_settlement SET reserved_usd=.025 WHERE run_id=?", run.id());
        assertThat(monthExposure()).isEqualByComparingTo(".025");
        jdbc.update("UPDATE app.platform_spend_settlement SET reserved_usd=.025 WHERE run_id=?", run.id());
        assertThat(monthExposure()).isEqualByComparingTo(".025");
        jdbc.update("UPDATE app.platform_spend_settlement SET settled_usd=.0008,reserved_usd=0,execution_closed=TRUE WHERE run_id=?", run.id());
        usage.snapshot(UUID.randomUUID());
        assertThat(monthExposure()).isEqualByComparingTo(".025");
    }

    @Test void unresolvedRunFromSeveralMonthsAgoStillCarriesItsWholeEnvelope() {
        var run = historical(UUID.randomUUID(), month.minusMonths(3).withDayOfMonth(3), ".017", ".0008", ".0162", false);
        usage.snapshot(UUID.randomUUID());
        assertThat(monthExposure()).isEqualByComparingTo(".017");
        assertThat(carried(run.id())).isTrue();
        usage.snapshot(UUID.randomUUID());
        assertThat(monthExposure()).isEqualByComparingTo(".017");
        assertThat(count("platform_spend_month_entry")).isOne();
    }

    @Test void replayedExcessSettlementAddsCurrentMonthCarryOnlyOnce() {
        var run = historical(UUID.randomUUID(), month.minusMonths(2).withDayOfMonth(3), ".017", "0", ".017", false);
        var at = Instant.now();
        var unknown = call(UUID.randomUUID(), false, ".025");
        sync(run, List.of(unknown), true, AgentRunStatus.FAILED, at);
        assertThat(monthExposure()).isEqualByComparingTo(".025");
        sync(run, List.of(unknown), true, AgentRunStatus.FAILED, at);
        sync(run, List.of(unknown), true, AgentRunStatus.FAILED, at.plusSeconds(1));
        usage.snapshot(UUID.randomUUID());
        assertThat(monthExposure()).isEqualByComparingTo(".025");
        assertThat(count("platform_provider_attempt")).isOne();
        assertThat(count("platform_spend_month_entry")).isOne();
        sync(run, List.of(call(unknown.callId(), true, ".025")), true, AgentRunStatus.FAILED, at.plusSeconds(2));
        assertThat(monthExposure()).isEqualByComparingTo(".025");
    }

    @Test void racingOldRunSettlementAndNewAdmissionCannotEraseNearLimitMonthCarry() throws Exception {
        var run = historical(UUID.randomUUID(), month.minusDays(1), ".017", "0", ".017", false);
        monthly(new BigDecimal(".018"), new BigDecimal(".019"));
        assertThat(count("platform_spend_month_entry")).isZero();
        var ready = new CountDownLatch(2);
        var start = new CountDownLatch(1);
        UUID candidateUser = UUID.randomUUID(), candidateRun = UUID.randomUUID();
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var settlement = pool.submit(() -> {
                ready.countDown();
                if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Settlement barrier timed out");
                // Production synchronization locks global settings before touching the settlement row.
                sync(run, List.of(call(UUID.randomUUID(), true, ".0017")), true, AgentRunStatus.COMPLETED, Instant.now());
                return true;
            });
            var admission = pool.submit(() -> {
                ready.countDown();
                if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Admission barrier timed out");
                try {
                    reserve(candidateUser, candidateRun);
                    return "ACCEPTED";
                } catch (PlatformSpendExhaustedException exhausted) {
                    return exhausted.getReason();
                }
            });
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(settlement.get(30, TimeUnit.SECONDS)).isTrue();
            assertThat(admission.get(30, TimeUnit.SECONDS)).contains("GLOBAL_MONTH_HARD_LIMIT");
        }
        assertThat(monthExposure()).isEqualByComparingTo(".017");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_reservation WHERE run_id=?", Integer.class, candidateRun)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_bucket WHERE subject_id=?", Integer.class, candidateUser)).isZero();
        assertThat(count("platform_spend_reservation")).isOne();
        assertThat(count("platform_completion_reservation")).isZero();
        assertThat(held("GLOBAL_DAY", GLOBAL, month.minusDays(1))).isEqualByComparingTo(".0008");
    }

    @Test void fullySettledClosedHistoricalRunDoesNotCreateNewMonthLiability() {
        historical(UUID.randomUUID(), month.minusDays(1), ".017", ".0008", "0", true);
        usage.snapshot(UUID.randomUUID());
        assertThat(monthExposure()).isZero();
        assertThat(count("platform_spend_month_entry")).isZero();
    }

    private int raceAdmissions(int clients) throws Exception {
        var ready = new CountDownLatch(clients);
        var start = new CountDownLatch(1);
        var secondInstance = new PlatformSpendService(jdbc, true, true);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<Boolean>> results = new ArrayList<>();
            for (int i = 0; i < clients; i++) {
                var instance = i % 2 == 0 ? spend : secondInstance;
                results.add(pool.submit(() -> {
                    ready.countDown();
                    if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Synthetic admission barrier timed out");
                    try {
                        tx.executeWithoutResult(status -> instance.reserve(UUID.randomUUID(), UUID.randomUUID(), LUNA, BUDGET));
                        return true;
                    } catch (PlatformSpendExhaustedException exhausted) { return false; }
                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            int accepted = 0;
            for (var result : results) if (result.get(30, TimeUnit.SECONDS)) accepted++;
            return accepted;
        }
    }

    private PlatformBudget reserve(UUID user, UUID run) {
        return tx.execute(status -> spend.reserve(user, run, LUNA, BUDGET));
    }

    private AgentRunEntity historical(UUID user, LocalDate day, String cap, String settled, String reserved, boolean closed) {
        UUID run = UUID.randomUUID();
        jdbc.update("UPDATE app.platform_spend_settings SET completion_required=FALSE WHERE id=1");
        tx.executeWithoutResult(status -> {
            rawParent(run, user, day, new BigDecimal(cap));
            jdbc.update("INSERT INTO app.platform_spend_settlement(run_id,settled_usd,reserved_usd,execution_closed) VALUES (?,?,?,?)",
                run, new BigDecimal(settled), new BigDecimal(reserved), closed);
            BigDecimal exposure = new BigDecimal(settled).add(new BigDecimal(reserved));
            jdbc.update("INSERT INTO app.platform_spend_bucket VALUES ('GLOBAL_DAY',?,?,?)", GLOBAL, Date.valueOf(day), exposure);
            jdbc.update("INSERT INTO app.platform_spend_bucket VALUES ('GLOBAL_WEEK',?,?,?)", GLOBAL, Date.valueOf(week(day)), exposure);
            jdbc.update("INSERT INTO app.platform_spend_bucket VALUES ('ACCOUNT_WEEK',?,?,?)", user, Date.valueOf(week(day)), exposure);
        });
        jdbc.update("UPDATE app.platform_spend_settings SET completion_required=TRUE WHERE id=1");
        return entity(run, user);
    }

    private void rawParent(UUID run, UUID user, LocalDate day, BigDecimal cap) {
        jdbc.update("""
            INSERT INTO app.platform_spend_reservation
                (run_id,user_id,provider,model,max_cost_usd,tariff_version,day_period,week_period,valid_until)
            VALUES (?,?,'OPENAI',?,?,?,?,?,?)
            """, run, user, LUNA.model(), cap, PlatformSpendTariff.VERSION, Date.valueOf(day), Date.valueOf(week(day)),
            Timestamp.from(day.plusDays(1).atStartOfDay(KOREA).toInstant()));
    }

    private AgentRunEntity entity(UUID run, UUID user) {
        return new AgentRunEntity(run, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), user,
            Provider.OPENAI, LUNA.model(), AgentRunStatus.RUNNING, Instant.now());
    }

    private ProviderCallUsage call(UUID id, boolean known, String reserve) {
        return new ProviderCallUsage(id, Provider.OPENAI, LUNA.model(), "responses.create", 1000, 500, 0, 0,
            BigDecimal.ZERO, new BigDecimal(reserve), known, "PLATFORM");
    }

    private void sync(AgentRunEntity run, List<ProviderCallUsage> calls, boolean closed, AgentRunStatus status, Instant at) {
        var report = new AgentRunView.AgentRunUsage(RequestTier.SINGLE_AGENT, calls.size(), 0,
            calls.stream().mapToLong(ProviderCallUsage::inputTokens).sum(), calls.stream().mapToLong(ProviderCallUsage::outputTokens).sum(),
            0, 0, 0, 0, 1, calls, BigDecimal.ZERO, run.id(), PlatformSpendTariff.VERSION, closed);
        var view = new AgentRunView(run.id(), status, null, null, null, null, null, report, at);
        tx.executeWithoutResult(transaction -> usage.synchronize(run, view));
    }

    private void monthly(BigDecimal soft, BigDecimal hard) {
        jdbc.update("UPDATE app.platform_spend_settings SET global_month_soft_usd=?,global_month_hard_usd=? WHERE id=1", soft, hard);
    }

    private BigDecimal monthExposure() {
        return jdbc.queryForObject("SELECT COALESCE(SUM(exposure_usd),0) FROM app.platform_spend_month_entry WHERE month_period=?",
            BigDecimal.class, Date.valueOf(month));
    }

    private boolean carried(UUID run) {
        return jdbc.queryForObject("SELECT carried FROM app.platform_spend_month_entry WHERE run_id=? AND month_period=?",
            Boolean.class, run, Date.valueOf(month));
    }

    private BigDecimal held(String scope, UUID subject, LocalDate period) {
        return jdbc.queryForObject("SELECT held_usd FROM app.platform_spend_bucket WHERE scope=? AND subject_id=? AND period=?",
            BigDecimal.class, scope, subject, Date.valueOf(period));
    }

    private long revision() {
        return jdbc.queryForObject("SELECT completion_policy_revision FROM app.platform_spend_settings WHERE id=1", Long.class);
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM app." + table, Integer.class);
    }

    private void assertEmptyAdmission() {
        for (String table : List.of("platform_spend_reservation", "platform_completion_reservation", "platform_spend_settlement",
                "platform_spend_bucket", "platform_spend_month_entry")) {
            assertThat(count(table)).as(table).isZero();
        }
    }

    private static PlatformUsageService.Model model(PlatformUsageService.Usage snapshot, String model) {
        return snapshot.models().stream().filter(entry -> entry.model().equals(model)).findFirst().orElseThrow();
    }

    private static BigDecimal multiple(int n) { return FULL.multiply(BigDecimal.valueOf(n)); }
    private static LocalDate week(LocalDate day) { return day.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)); }
}
