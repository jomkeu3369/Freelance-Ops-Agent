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
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.service.ByokCostNoticePolicy;
import com.freelanceops.backend.domain.agentrun.service.ByokExecutionService;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendAdminService;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendExhaustedException;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendService;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendTariff;
import com.freelanceops.backend.domain.agentrun.service.PlatformSpendUnavailableException;
import com.freelanceops.backend.domain.agentrun.service.PlatformUsageService;
import com.freelanceops.backend.domain.identity.service.AdminMemberService;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

/** Real monetary admission and authorization in a disposable PostgreSQL container.
 * All accounts, workspaces and credentials are synthetic. No provider or agent HTTP calls. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {"app.environment=test", "platform.ai.spend.enabled=true",
    "APP_BYOK_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "agent.command-dispatch-enabled=false", "agent.reconciliation-enabled=false"})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Timeout(60)
class PlatformSpendAdminPostgresTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));

    @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.flyway.create-schemas", () -> true);
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired PlatformSpendAdminService adminService;
    @Autowired AdminMemberService memberAdmin;
    @Autowired MockMvc mvc;
    @Autowired PlatformSpendService spend;
    @Autowired PlatformUsageService usage;
    @Autowired ByokExecutionService byok;
    @Autowired AgentRunRepository runs;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired PlatformTransactionManager manager;
    private TransactionTemplate tx;
    private UUID admin;
    private static final UUID GLOBAL = new UUID(0, 0);
    private static final String MODEL = "gpt-6-luna";
    private static final ModelSelection LUNA = new ModelSelection(Provider.OPENAI, MODEL, ReasoningEffort.LOW);
    private static final BigDecimal ACCOUNT = new BigDecimal("1.25");
    private static final BigDecimal DAY = new BigDecimal("25");
    private static final BigDecimal WEEK = new BigDecimal("100");
    private static final BigDecimal CAP = new BigDecimal(".10");

    @BeforeEach void setup() {
        tx = new TransactionTemplate(manager);
        // Fixture cleanup is limited to this class's disposable database. Immutable production
        // ledger and audit tables are never deleted through the application under test.
        jdbc.execute("TRUNCATE app.agent_run_usage, app.platform_provider_attempt, app.platform_spend_settlement, "
            + "app.platform_spend_reservation, app.platform_spend_bucket, app.platform_spend_admin_audit");
        jdbc.update("""
            UPDATE app.platform_spend_settings SET luna_run_usd=.10,terra_run_usd=1,
                account_week_usd=1.25,global_day_usd=25,global_week_usd=100,
                revision=0,updated_at=clock_timestamp() WHERE id=1
            """);
        jdbc.update("""
            UPDATE app.platform_spend_model_cap SET enabled=TRUE,
                max_run_usd=CASE WHEN model IN ('gpt-6-luna','gpt-5.6-luna') THEN .10 ELSE 1 END
            """);
        admin = account();
        grant(admin, "FREE_USAGE_ADMIN");
    }

    @Test void settingsReadsMoneyAndRuntimeSwitchWithoutChangingAnyLedger() {
        var before = state();
        var settings = adminService.settings(admin);
        assertThat(settings.currency()).isEqualTo("USD");
        assertThat(settings.accountWeekUsd()).isEqualByComparingTo(ACCOUNT);
        assertThat(settings.globalDayUsd()).isEqualByComparingTo(DAY);
        assertThat(settings.globalWeekUsd()).isEqualByComparingTo(WEEK);
        assertThat(settings.revision()).isZero();
        assertThat(settings.updatedAt()).isNotNull();
        assertThat(settings.spendingEnabled()).isTrue();
        assertThat(settings.maxBudgetUsd()).isGreaterThanOrEqualTo(WEEK);
        assertThat(settings.maxModelRunUsd()).isGreaterThanOrEqualTo(CAP);
        assertThat(settings.models()).hasSize(7);
        assertThat(settings.models()).allSatisfy(model -> {
            assertThat(model.provider()).isEqualTo(Provider.OPENAI);
            assertThat(model.maxRunUsd()).isPositive();
            assertThat(model.enabled()).isTrue();
        });
        assertThat(state()).isEqualTo(before);
    }

    @Test void preservedLegacyBudgetsAreExactReadableStringsAndCanBeLoweredWithinTheEditCeiling() throws Exception {
        // Only this synthetic fixture exceeds the new edit ceiling. V48 never rewrites operator budgets.
        jdbc.update("UPDATE app.platform_spend_settings SET account_week_usd=?,global_day_usd=?,global_week_usd=? WHERE id=1",
            new BigDecimal("99999999999.99999999"), new BigDecimal("100000.00000001"), new BigDecimal("100001.12345678"));
        var before = state();
        var moneyBefore = moneyState();
        mvc.perform(get("/api/v2/admin/ai-spending").with(jwt().jwt(token -> token.subject(admin.toString()))))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
            .andExpect(jsonPath("accountWeekUsd").isString()).andExpect(jsonPath("accountWeekUsd").value("99999999999.99999999"))
            .andExpect(jsonPath("globalDayUsd").isString()).andExpect(jsonPath("globalDayUsd").value("100000.00000001"))
            .andExpect(jsonPath("globalWeekUsd").isString()).andExpect(jsonPath("globalWeekUsd").value("100001.12345678"));
        assertThat(adminService.settings(admin).accountWeekUsd()).isEqualByComparingTo("99999999999.99999999");
        // Preserving an old value on read does not authorize writing above the new ceiling.
        mvc.perform(patch("/api/v2/admin/ai-spending").with(jwt().jwt(token -> token.subject(admin.toString())))
            .contentType("application/json")
            .content("{\"accountWeekUsd\":\"100000.00000001\",\"globalDayUsd\":25,\"globalWeekUsd\":100,\"expectedRevision\":0}"))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isBadRequest());
        status(400, () -> adminService.changeBudgets(admin, new BigDecimal("100000.00000001"), DAY, WEEK, 0L));
        assertThat(state()).isEqualTo(before);
        mvc.perform(patch("/api/v2/admin/ai-spending").with(jwt().jwt(token -> token.subject(admin.toString())))
            .contentType("application/json")
            .content("{\"accountWeekUsd\":\"100000\",\"globalDayUsd\":\"0.00000001\",\"globalWeekUsd\":\"42.12345678\",\"expectedRevision\":0}"))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
            .andExpect(jsonPath("accountWeekUsd").value("100000.00000000"))
            .andExpect(jsonPath("globalDayUsd").value("0.00000001"))
            .andExpect(jsonPath("globalWeekUsd").value("42.12345678"))
            .andExpect(jsonPath("revision").value(1));
        assertThat(adminService.settings(admin).accountWeekUsd()).isEqualByComparingTo("100000");
        assertThat(moneyState()).isEqualTo(moneyBefore);
        String audit = jdbc.queryForObject("SELECT previous_value FROM app.platform_spend_admin_audit WHERE new_revision=1", String.class);
        assertThat(audit).contains("99999999999.99999999", "100000.00000001", "100001.12345678");
    }

    @Test void apiRejectsRuntimeSwitchAndResetFieldsWithoutMutatingAnything() throws Exception {
        var before = state();
        for (String extra : List.of("\"spendingEnabled\":true", "\"spendingEnabled\":false", "\"reset\":true", "\"revision\":5")) {
            mvc.perform(patch("/api/v2/admin/ai-spending").with(jwt().jwt(token -> token.subject(admin.toString())))
                .contentType("application/json")
                .content("{\"accountWeekUsd\":2,\"globalDayUsd\":25,\"globalWeekUsd\":100,\"expectedRevision\":0," + extra + "}"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isBadRequest());
            mvc.perform(patch("/api/v2/admin/ai-spending/models").with(jwt().jwt(token -> token.subject(admin.toString())))
                .contentType("application/json")
                .content("{\"provider\":\"OPENAI\",\"model\":\"gpt-6-luna\",\"maxRunUsd\":0.2,\"enabled\":true,\"expectedRevision\":0," + extra + "}"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isBadRequest());
        }
        mvc.perform(get("/api/v2/admin/ai-spending").with(jwt().jwt(token -> token.subject(admin.toString()))))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
            .andExpect(jsonPath("spendingEnabled").value(true)).andExpect(jsonPath("revision").value(0));
        assertThat(state()).isEqualTo(before);
    }

    @Test void apiCannotSubstituteWorkspaceRoleClaimsForThePlatformCapability() throws Exception {
        UUID member = account();
        var before = state();
        mvc.perform(get("/api/v2/admin/ai-spending"))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isUnauthorized());
        mvc.perform(get("/api/v2/admin/ai-spending").with(jwt().jwt(token -> token.subject(member.toString()))
            .authorities(new SimpleGrantedAuthority("ROLE_OWNER"), new SimpleGrantedAuthority("ROLE_ADMIN"))))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isForbidden());
        mvc.perform(patch("/api/v2/admin/ai-spending").with(jwt().jwt(token -> token.subject(member.toString()))
            .authorities(new SimpleGrantedAuthority("ROLE_OWNER"), new SimpleGrantedAuthority("ROLE_ADMIN")))
            .contentType("application/json").content("{\"accountWeekUsd\":0,\"globalDayUsd\":0,\"globalWeekUsd\":0,\"expectedRevision\":0}"))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isForbidden());
        mvc.perform(patch("/api/v2/admin/ai-spending/models").with(jwt().jwt(token -> token.subject(member.toString()))
            .authorities(new SimpleGrantedAuthority("ROLE_OWNER"), new SimpleGrantedAuthority("ROLE_ADMIN")))
            .contentType("application/json").content("{\"provider\":\"OPENAI\",\"model\":\"gpt-6-luna\",\"maxRunUsd\":0,\"enabled\":false,\"expectedRevision\":0}"))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isForbidden());
        assertThat(state()).isEqualTo(before);
    }

    @Test void verificationMatchesLegacyAccountSemanticsInsteadOfRequiringAnInventedTimestamp() {
        assertThat(jdbc.queryForObject("SELECT email_verified_at IS NULL FROM app.user_account WHERE id=?",
            Boolean.class, admin)).isTrue();
        assertThat(adminService.settings(admin).revision()).isZero();
        assertThat(adminService.changeBudgets(admin, new BigDecimal("2"), DAY, WEEK, 0L).revision()).isOne();
        jdbc.update("UPDATE app.user_account SET email_verified_at=clock_timestamp() WHERE id=?", admin);
        assertThat(adminService.changeModel(admin, Provider.OPENAI, MODEL, new BigDecimal(".20"), true, 1L).revision()).isEqualTo(2);
        jdbc.update("UPDATE app.user_account SET email_verification_required=TRUE WHERE id=?", admin);
        assertForbiddenAndUnchanged(admin);
    }

    @ParameterizedTest
    @ValueSource(strings = {"MISSING_ACCOUNT", "NO_GRANT", "MEMBERS_READ", "REVOKED", "DISABLED", "PENDING_VERIFICATION"})
    void everyOperationRequiresCurrentActiveVerifiedFreeUsageAdministrator(String condition) {
        UUID actor = "MISSING_ACCOUNT".equals(condition) ? UUID.randomUUID() : account();
        if (List.of("REVOKED", "DISABLED", "PENDING_VERIFICATION").contains(condition)) grant(actor, "FREE_USAGE_ADMIN");
        switch (condition) {
            case "MEMBERS_READ" -> grant(actor, "MEMBERS_READ");
            case "REVOKED" -> jdbc.update("UPDATE app.platform_admin_grant SET revoked_at=clock_timestamp() WHERE user_id=?", actor);
            case "DISABLED" -> jdbc.update("UPDATE app.user_account SET status='DISABLED' WHERE id=?", actor);
            case "PENDING_VERIFICATION" -> jdbc.update("UPDATE app.user_account SET email_verification_required=TRUE WHERE id=?", actor);
            default -> { }
        }
        assertForbiddenAndUnchanged(actor);
    }

    @Test void budgetAndModelChangesShareOneRevisionAndKeepExactBeforeAfterAudits() {
        var before = adminService.settings(admin);
        var budgets = adminService.changeBudgets(admin, new BigDecimal("2.12345678"), new BigDecimal("30"),
            new BigDecimal("120"), before.revision());
        assertThat(budgets.revision()).isEqualTo(before.revision() + 1);
        assertThat(budgets.updatedAt()).isAfter(before.updatedAt());
        assertThat(budgets.accountWeekUsd()).isEqualByComparingTo("2.12345678");
        assertThat(budgets.globalDayUsd()).isEqualByComparingTo("30");
        assertThat(budgets.globalWeekUsd()).isEqualByComparingTo("120");
        var changed = adminService.changeModel(admin, Provider.OPENAI, MODEL, new BigDecimal(".23456789"), false,
            budgets.revision());
        assertThat(changed.revision()).isEqualTo(before.revision() + 2);
        assertThat(changed.updatedAt()).isAfter(budgets.updatedAt());
        assertThat(changed.accountWeekUsd()).isEqualByComparingTo(budgets.accountWeekUsd());
        var model = changed.models().stream().filter(row -> row.model().equals(MODEL)).findFirst().orElseThrow();
        assertThat(model.maxRunUsd()).isEqualByComparingTo(".23456789");
        assertThat(model.enabled()).isFalse();

        var audits = jdbc.queryForList("SELECT * FROM app.platform_spend_admin_audit ORDER BY new_revision");
        assertThat(audits).hasSize(2);
        assertAudit(audits.getFirst(), "CHANGE_BUDGETS", before.revision(), budgets.revision());
        assertAudit(audits.getLast(), "CHANGE_MODEL", budgets.revision(), changed.revision());
        var oldBudgets = mapper.readTree((String) audits.getFirst().get("previous_value"));
        var newBudgets = mapper.readTree((String) audits.getFirst().get("new_value"));
        assertThat(oldBudgets.path("accountWeekUsd").decimalValue()).isEqualByComparingTo(ACCOUNT);
        assertThat(oldBudgets.path("globalDayUsd").decimalValue()).isEqualByComparingTo(DAY);
        assertThat(oldBudgets.path("globalWeekUsd").decimalValue()).isEqualByComparingTo(WEEK);
        assertThat(newBudgets.path("accountWeekUsd").decimalValue()).isEqualByComparingTo("2.12345678");
        assertThat(newBudgets.path("globalDayUsd").decimalValue()).isEqualByComparingTo("30");
        assertThat(newBudgets.path("globalWeekUsd").decimalValue()).isEqualByComparingTo("120");
        var oldModel = mapper.readTree((String) audits.getLast().get("previous_value"));
        var newModel = mapper.readTree((String) audits.getLast().get("new_value"));
        assertThat(oldModel.path("maxRunUsd").decimalValue()).isEqualByComparingTo(CAP);
        assertThat(oldModel.path("enabled").booleanValue()).isTrue();
        assertThat(newModel.path("maxRunUsd").decimalValue()).isEqualByComparingTo(".23456789");
        assertThat(newModel.path("enabled").booleanValue()).isFalse();
        for (var audit : audits) {
            assertThatThrownBy(() -> jdbc.update("UPDATE app.platform_spend_admin_audit SET new_value='{}' WHERE id=?", audit.get("id")))
                .isInstanceOf(DataAccessException.class);
            assertThatThrownBy(() -> jdbc.update("DELETE FROM app.platform_spend_admin_audit WHERE id=?", audit.get("id")))
                .isInstanceOf(DataAccessException.class);
        }
        assertThat(jdbc.queryForList("SELECT * FROM app.platform_spend_admin_audit ORDER BY new_revision")).isEqualTo(audits);
    }

    @Test void existingMemberAuditReadsOriginalMoneySnapshotsWithoutGrantingExtraCapabilities() {
        adminService.changeBudgets(admin, new BigDecimal("2.12345678"), DAY, WEEK, 0L);
        var original = jdbc.queryForMap("SELECT * FROM app.platform_spend_admin_audit");
        status(403, () -> memberAdmin.audits(admin, 0, 100));
        UUID reader = account();
        grant(reader, "MEMBERS_READ");
        var before = state();
        var rows = memberAdmin.audits(reader, 0, 100).items().stream()
            .filter(row -> row.id().equals(original.get("id"))).toList();
        assertThat(rows).hasSize(1);
        var row = rows.getFirst();
        assertThat(row.source()).isEqualTo("PLATFORM_SPEND");
        assertThat(row.previousValue()).isEqualTo(original.get("previous_value"));
        assertThat(row.newValue()).isEqualTo(original.get("new_value"));
        assertThat(row.previousEpoch()).isZero();
        assertThat(row.newEpoch()).isOne();
        assertThat(state()).isEqualTo(before);
        assertForbiddenAndUnchanged(reader);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_admin_grant WHERE user_id=? AND capability='MEMBERS_READ'",
            Integer.class, admin)).isZero();
    }

    @Test void staleBudgetAndModelChangesCannotPartiallyWriteOrAppendAudits() {
        long stale = adminService.settings(admin).revision();
        adminService.changeBudgets(admin, new BigDecimal("2"), DAY, WEEK, stale);
        var before = state();
        status(409, () -> adminService.changeBudgets(admin, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, stale));
        assertThat(state()).isEqualTo(before);
        status(409, () -> adminService.changeModel(admin, Provider.OPENAI, MODEL, BigDecimal.ZERO, false, stale));
        assertThat(state()).isEqualTo(before);
    }

    @Test void noOpChangesKeepRevisionTimestampAndAuditButStillRequireCurrentRevision() {
        var before = adminService.settings(admin);
        var untouched = state();
        assertThat(adminService.changeBudgets(admin, new BigDecimal("1.25000000"), DAY, WEEK, before.revision()))
            .isEqualTo(before);
        assertThat(adminService.changeModel(admin, Provider.OPENAI, MODEL, new BigDecimal(".10000000"), true, before.revision()))
            .isEqualTo(before);
        assertThat(state()).isEqualTo(untouched);
        adminService.changeBudgets(admin, new BigDecimal("2"), DAY, WEEK, before.revision());
        var after = state();
        status(409, () -> adminService.changeBudgets(admin, new BigDecimal("2"), DAY, WEEK, before.revision()));
        status(409, () -> adminService.changeModel(admin, Provider.OPENAI, MODEL, CAP, true, before.revision()));
        assertThat(state()).isEqualTo(after);
    }

    @Test void inclusiveUpperBoundsAndSmallestUsdFractionAreStoredWithoutRounding() {
        var before = adminService.settings(admin);
        var budgets = adminService.changeBudgets(admin, before.maxBudgetUsd(), before.maxBudgetUsd(),
            before.maxBudgetUsd(), before.revision());
        assertThat(budgets.accountWeekUsd()).isEqualByComparingTo(before.maxBudgetUsd());
        assertThat(budgets.globalDayUsd()).isEqualByComparingTo(before.maxBudgetUsd());
        assertThat(budgets.globalWeekUsd()).isEqualByComparingTo(before.maxBudgetUsd());
        var maxModel = adminService.changeModel(admin, Provider.OPENAI, MODEL, before.maxModelRunUsd(), true, budgets.revision());
        assertThat(reserve(account(), UUID.randomUUID()).maxCostUsd()).isEqualByComparingTo(before.maxModelRunUsd());
        adminService.changeModel(admin, Provider.OPENAI, MODEL, new BigDecimal(".00000001"), true, maxModel.revision());
        assertThat(reserve(account(), UUID.randomUUID()).maxCostUsd()).isEqualByComparingTo(".00000001");
    }

    @Test void invalidAndOverpreciseMoneyMissingFieldsAndUnknownModelsAreSideEffectFree() {
        var settings = adminService.settings(admin);
        var before = state();
        for (BigDecimal invalid : List.of(new BigDecimal("-.00000001"), new BigDecimal(".000000001"), new BigDecimal("1.000000000"),
                settings.maxBudgetUsd().add(BigDecimal.ONE))) {
            status(400, () -> adminService.changeBudgets(admin, invalid, DAY, WEEK, settings.revision()));
            status(400, () -> adminService.changeBudgets(admin, ACCOUNT, invalid, WEEK, settings.revision()));
            status(400, () -> adminService.changeBudgets(admin, ACCOUNT, DAY, invalid, settings.revision()));
        }
        for (BigDecimal invalid : List.of(new BigDecimal("-.00000001"), new BigDecimal(".000000001"), new BigDecimal("1.000000000"),
                settings.maxModelRunUsd().add(BigDecimal.ONE))) {
            status(400, () -> adminService.changeModel(admin, Provider.OPENAI, MODEL, invalid, true, settings.revision()));
        }
        status(400, () -> adminService.changeBudgets(admin, null, DAY, WEEK, settings.revision()));
        status(400, () -> adminService.changeBudgets(admin, ACCOUNT, null, WEEK, settings.revision()));
        status(400, () -> adminService.changeBudgets(admin, ACCOUNT, DAY, null, settings.revision()));
        status(400, () -> adminService.changeBudgets(admin, ACCOUNT, DAY, WEEK, null));
        status(400, () -> adminService.changeBudgets(admin, ACCOUNT, DAY, WEEK, -1L));
        status(400, () -> adminService.changeModel(admin, null, MODEL, CAP, true, settings.revision()));
        status(400, () -> adminService.changeModel(admin, Provider.GEMINI, MODEL, CAP, true, settings.revision()));
        status(400, () -> adminService.changeModel(admin, Provider.OPENAI, null, CAP, true, settings.revision()));
        status(400, () -> adminService.changeModel(admin, Provider.OPENAI, "not-an-approved-model", CAP, true, settings.revision()));
        status(400, () -> adminService.changeModel(admin, Provider.OPENAI, MODEL, null, true, settings.revision()));
        status(400, () -> adminService.changeModel(admin, Provider.OPENAI, MODEL, CAP, null, settings.revision()));
        status(400, () -> adminService.changeModel(admin, Provider.OPENAI, MODEL, CAP, true, null));
        status(400, () -> adminService.changeModel(admin, Provider.OPENAI, MODEL, CAP, true, -1L));
        assertThat(state()).isEqualTo(before);
    }

    @Test void outerTransactionRollbackRestoresSettingsModelAndAuditsTogether() {
        var before = state();
        assertThatThrownBy(() -> tx.executeWithoutResult(transaction -> {
            var changed = adminService.changeBudgets(admin, BigDecimal.ZERO, DAY, WEEK, 0L);
            adminService.changeModel(admin, Provider.OPENAI, MODEL, BigDecimal.ZERO, false, changed.revision());
            throw new IllegalStateException("synthetic transaction rollback");
        })).isInstanceOf(IllegalStateException.class).hasMessage("synthetic transaction rollback");
        assertThat(state()).isEqualTo(before);
    }

    @ParameterizedTest
    @ValueSource(strings = {"ACCOUNT_WEEK", "GLOBAL_DAY", "GLOBAL_WEEK"})
    void settingAnyMonetaryBudgetToZeroStopsActualAdmissionAtomically(String scope) {
        adminService.changeBudgets(admin, scope.equals("ACCOUNT_WEEK") ? BigDecimal.ZERO : ACCOUNT,
            scope.equals("GLOBAL_DAY") ? BigDecimal.ZERO : DAY,
            scope.equals("GLOBAL_WEEK") ? BigDecimal.ZERO : WEEK, 0L);
        UUID user = account();
        var before = state();
        assertThatThrownBy(() -> reserve(user, UUID.randomUUID()))
            .isInstanceOf(PlatformSpendExhaustedException.class).hasMessageContaining(scope);
        assertThat(state()).isEqualTo(before);
        var snapshot = usage.snapshot(user);
        assertThat(snapshot.models()).allSatisfy(model -> {
            assertThat(model.available()).isFalse();
            // Promotional tariff checks are independent of the budget gate.
            if (!model.model().equals("gpt-5.6-sol")) assertThat(model.unavailableReason())
                .isEqualTo(scope.equals("ACCOUNT_WEEK") ? "ACCOUNT_BUDGET_EXHAUSTED" : "GLOBAL_BUDGET_EXHAUSTED");
        });
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void zeroCapOrDisabledModelStopsAdmissionBeforeCreatingAnyReservation(boolean zeroCap) {
        adminService.changeModel(admin, Provider.OPENAI, MODEL, zeroCap ? BigDecimal.ZERO : CAP, zeroCap, 0L);
        var before = state();
        UUID user = account();
        assertThatThrownBy(() -> reserve(user, UUID.randomUUID())).isInstanceOf(PlatformSpendUnavailableException.class);
        assertThat(state()).isEqualTo(before);
        var model = usage.snapshot(user).models().stream().filter(row -> row.model().equals(MODEL)).findFirst().orElseThrow();
        assertThat(model.available()).isFalse();
        assertThat(model.unavailableReason()).isEqualTo("MODEL_DISABLED");
        assertThat(model.maxRunUsd()).isEqualByComparingTo(zeroCap ? BigDecimal.ZERO : CAP);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_bucket", Integer.class)).isZero();
    }

    @Test void priorReservationsTariffsSettlementsAndHeldMoneySurviveAllAdminEditsAndReplay() {
        UUID user = account(), run = UUID.randomUUID();
        PlatformBudget original = reserve(user, run);
        var day = jdbc.queryForObject("SELECT day_period FROM app.platform_spend_reservation WHERE run_id=?", java.sql.Date.class, run);
        var week = jdbc.queryForObject("SELECT week_period FROM app.platform_spend_reservation WHERE run_id=?", java.sql.Date.class, run);
        var oldDay = java.sql.Date.valueOf(day.toLocalDate().minusWeeks(1));
        var oldWeek = java.sql.Date.valueOf(week.toLocalDate().minusWeeks(1));
        UUID oldRun = UUID.randomUUID();
        Instant observed = jdbc.queryForObject("SELECT clock_timestamp()", java.sql.Timestamp.class).toInstant();
        tx.executeWithoutResult(transaction -> {
            // Historical admission is inserted directly because immutable reservations cannot
            // be moved to an earlier period. Both reports use the real settlement service.
            jdbc.update("""
                INSERT INTO app.platform_spend_reservation
                    (run_id,user_id,provider,model,max_cost_usd,tariff_version,day_period,week_period,valid_until)
                VALUES (?,?,'OPENAI','gpt-5.6-luna',.10,?,?,?,?)
                """, oldRun, user, PlatformSpendTariff.LEGACY_VERSION, oldDay, oldWeek,
                java.sql.Timestamp.from(original.validUntil().minusSeconds(7 * 86400)));
            jdbc.update("INSERT INTO app.platform_spend_settlement(run_id,reserved_usd) VALUES (?,.10)", oldRun);
            jdbc.update("INSERT INTO app.platform_spend_bucket VALUES ('ACCOUNT_WEEK',?,?,.10)", user, oldWeek);
            jdbc.update("INSERT INTO app.platform_spend_bucket VALUES ('GLOBAL_WEEK',?,?,.10)", GLOBAL, oldWeek);
            jdbc.update("INSERT INTO app.platform_spend_bucket VALUES ('GLOBAL_DAY',?,?,.10)", GLOBAL, oldDay);
            synchronizeKnownAndUnknownAttempts(run, user, MODEL, original.tariffVersion(), observed);
            synchronizeKnownAndUnknownAttempts(oldRun, user, "gpt-5.6-luna", PlatformSpendTariff.LEGACY_VERSION,
                observed.minusSeconds(7 * 86400));
        });
        assertThat(jdbc.queryForObject("SELECT settled_usd FROM app.platform_spend_settlement WHERE run_id=?",
            BigDecimal.class, run)).isEqualByComparingTo(".00035");
        assertThat(jdbc.queryForObject("SELECT settled_usd FROM app.platform_spend_settlement WHERE run_id=?",
            BigDecimal.class, oldRun)).isEqualByComparingTo(".0008");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_provider_attempt WHERE payload->>'usageKnown'='false'",
            Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_bucket", Integer.class)).isEqualTo(6);
        var moneyBefore = moneyState();
        var creditBefore = creditState();
        var changed = adminService.changeBudgets(admin, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, 0L);
        adminService.changeModel(admin, Provider.OPENAI, MODEL, BigDecimal.ZERO, false, changed.revision());
        assertThat(moneyState()).isEqualTo(moneyBefore);
        assertThat(creditState()).isEqualTo(creditBefore);
        assertThat(reserve(user, run)).isEqualTo(original);
        assertThat(moneyState()).isEqualTo(moneyBefore);
        for (var bucket : moneyBefore.get("platform_spend_bucket"))
            assertThat((BigDecimal) bucket.get("held_usd")).isEqualByComparingTo(original.maxCostUsd());
        assertThat(jdbc.queryForObject("SELECT tariff_version FROM app.platform_spend_reservation WHERE run_id=?",
            String.class, run)).isEqualTo(original.tariffVersion());
        assertThat(jdbc.queryForObject("SELECT tariff_version FROM app.platform_spend_reservation WHERE run_id=?",
            String.class, oldRun)).isEqualTo(PlatformSpendTariff.LEGACY_VERSION);
        assertThat(usage.snapshot(user).settledUsd()).isEqualByComparingTo(".00035");
        assertThat(usage.snapshot(user).reservedUsd()).isEqualByComparingTo(".09965");
        assertThat(usage.snapshot(user).remainingUsd()).isZero();
    }

    @Test void changedBudgetAndModelCapBothApplyToTheNextActualReservationWithoutRefundingTheFirst() {
        UUID user = account();
        var original = reserve(user, UUID.randomUUID());
        var changed = adminService.changeBudgets(admin, new BigDecimal(".15"), DAY, WEEK, 0L);
        adminService.changeModel(admin, Provider.OPENAI, MODEL, new BigDecimal(".08"), true, changed.revision());
        assertThat(original.maxCostUsd()).isEqualByComparingTo(".10");
        var next = reserve(user, UUID.randomUUID());
        assertThat(next.maxCostUsd()).isEqualByComparingTo(".05");
        assertThat(held("ACCOUNT_WEEK", user)).isEqualByComparingTo(".15");
        assertThatThrownBy(() -> reserve(user, UUID.randomUUID())).isInstanceOf(PlatformSpendExhaustedException.class);
        var other = reserve(account(), UUID.randomUUID());
        assertThat(other.maxCostUsd()).isEqualByComparingTo(".08");
    }

    @Test void budgetAndModelEditsCannotTurnOnTheEnvironmentSpendingSwitch() {
        var disabledAdmin = new PlatformSpendAdminService(jdbc, mapper, false);
        var disabledSpend = new PlatformSpendService(jdbc, false);
        var disabledUsage = new PlatformUsageService(jdbc, mapper, false);
        tx.executeWithoutResult(transaction -> {
            var budgets = disabledAdmin.changeBudgets(admin, new BigDecimal("2"), DAY, WEEK, 0L);
            assertThat(budgets.spendingEnabled()).isFalse();
            var models = disabledAdmin.changeModel(admin, Provider.OPENAI, MODEL, BigDecimal.ONE, true, budgets.revision());
            assertThat(models.spendingEnabled()).isFalse();
            assertThat(disabledAdmin.settings(admin).spendingEnabled()).isFalse();
        });
        UUID user = account();
        var before = moneyState();
        assertThatThrownBy(() -> tx.executeWithoutResult(transaction -> disabledSpend.reserve(user, UUID.randomUUID(), LUNA)))
            .isInstanceOf(PlatformSpendUnavailableException.class);
        assertThat(tx.execute(transaction -> disabledUsage.snapshot(user)).spendingEnabled()).isFalse();
        assertThat(tx.execute(transaction -> disabledUsage.snapshot(user)).models()).allSatisfy(model -> {
            assertThat(model.available()).isFalse();
            assertThat(model.unavailableReason()).isEqualTo("SPENDING_DISABLED");
        });
        assertThat(moneyState()).isEqualTo(before);
    }

    @Test void separatePersonalExecutionStillAdmitsSyntheticAttemptsWithAllPlatformBudgetsAndModelDisabled() {
        var changed = adminService.changeBudgets(admin, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, 0L);
        adminService.changeModel(admin, Provider.OPENAI, MODEL, BigDecimal.ZERO, false, changed.revision());
        var moneyBefore = moneyState();
        var creditBefore = creditState();
        UUID user = account(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
        UUID member = UUID.randomUUID(), role = UUID.randomUUID(), credential = UUID.randomUUID();
        jdbc.update("INSERT INTO app.workspace(id,name,slug,status,created_by) VALUES (?,'Synthetic',?,'ACTIVE',?)",
            workspace, "spend-admin-byok-" + workspace, user);
        jdbc.update("INSERT INTO app.project(id,workspace_id,title,requirement_text,currency,created_by) VALUES (?,?,'Synthetic','Synthetic','USD',?)",
            project, workspace, user);
        jdbc.update("INSERT INTO app.workspace_member(id,workspace_id,user_id,status) VALUES (?,?,?,'ACTIVE')", member, workspace, user);
        jdbc.update("INSERT INTO app.workspace_role(id,workspace_id,code,display_name) VALUES (?,?,'TEST','Test')", role, workspace);
        for (String permission : List.of("agent.run", "project.read"))
            jdbc.update("INSERT INTO app.role_permission(workspace_id,role_id,permission_code) VALUES (?,?,?)", workspace, role, permission);
        jdbc.update("INSERT INTO app.member_role(workspace_id,membership_id,role_id,assigned_by) VALUES (?,?,?,?)", workspace, member, role, user);
        jdbc.update("INSERT INTO app.ai_connection(id,workspace_id,user_id,provider,model,ciphertext,masked_key) VALUES (?,?,?,'OPENAI',?,'synthetic-never-decrypted','test')",
            credential, workspace, user, MODEL);
        var budget = new RunBudget(180, 2, 12, 20000, 1000, 4, 2, 0, 1, 3);
        var run = new AgentRunEntity(UUID.randomUUID(), workspace, project, UUID.randomUUID(), user, Provider.OPENAI,
            MODEL, ReasoningEffort.LOW, budget, AgentRunStatus.RUNNING, Instant.now());
        run.useCredential(credential);
        var scope = tx.execute(transaction -> {
            var issued = byok.issue(run.id(), user, workspace, project,
                new ModelSelection(Provider.OPENAI, MODEL, ReasoningEffort.LOW, credential), budget, ByokCostNoticePolicy.VERSION);
            runs.saveAndFlush(run);
            return issued;
        });
        UUID call = UUID.randomUUID();
        var admission = byok.admit(scope.scopeId(), new ByokExecutionService.Attempt(call, credential, Provider.OPENAI,
            MODEL, ReasoningEffort.LOW, "BYOK", "default", "department_work_product", 10000, 500),
            new ByokExecutionService.ExecutionPrincipal(run.id(), workspace, project, user, Set.of("agent.run", "project.read")));
        assertThat(admission.admitted()).isTrue();
        assertThat(admission.fundingSource()).isEqualTo("BYOK");
        assertThat(jdbc.queryForObject("SELECT model_calls FROM app.byok_execution_scope WHERE scope_id=?", Integer.class, scope.scopeId())).isOne();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.byok_provider_attempt WHERE call_id=?", Integer.class, call)).isOne();
        var personalBefore = rows("byok_execution_scope", "byok_provider_attempt");
        var restored = adminService.changeBudgets(admin, ACCOUNT, DAY, WEEK, adminService.settings(admin).revision());
        adminService.changeModel(admin, Provider.OPENAI, MODEL, CAP, true, restored.revision());
        assertThat(rows("byok_execution_scope", "byok_provider_attempt")).isEqualTo(personalBefore);
        assertThat(moneyState()).isEqualTo(moneyBefore);
        assertThat(creditState()).isEqualTo(creditBefore);
    }

    @Test void concurrentIndependentAdminInstancesAcceptExactlyOneWriterForTheSameRevision() throws Exception {
        var otherInstance = new PlatformSpendAdminService(jdbc, mapper, true);
        var ready = new CountDownLatch(2);
        var start = new CountDownLatch(1);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = pool.submit(() -> competingChange(adminService, new BigDecimal("2"), ready, start));
            var second = pool.submit(() -> competingChange(otherInstance, new BigDecimal("3"), ready, start));
            try { assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue(); }
            finally { start.countDown(); }
            assertThat(List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS)))
                .containsExactlyInAnyOrder(200, 409);
        }
        assertThat(adminService.settings(admin).revision()).isOne();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_admin_audit", Integer.class)).isOne();
    }

    @Test void admittedReservationCommitsBeforeConcurrentBudgetChangeWithoutBeingRepriced() throws Exception {
        UUID user = account(), run = UUID.randomUUID();
        var reserved = new CountDownLatch(1);
        var commit = new CountDownLatch(1);
        var writerStarted = new CountDownLatch(1);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<PlatformBudget> admission = pool.submit(() -> tx.execute(transaction -> {
                var value = spend.reserve(user, run, LUNA);
                reserved.countDown();
                await(commit);
                return value;
            }));
            Future<PlatformSpendAdminService.Settings> mutation;
            try {
                assertThat(reserved.await(10, TimeUnit.SECONDS)).isTrue();
                mutation = pool.submit(() -> {
                    writerStarted.countDown();
                    return adminService.changeBudgets(admin, BigDecimal.ZERO, DAY, WEEK, 0L);
                });
                assertThat(writerStarted.await(10, TimeUnit.SECONDS)).isTrue();
                assertThatThrownBy(() -> mutation.get(250, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
            } finally { commit.countDown(); }
            var original = admission.get(10, TimeUnit.SECONDS);
            assertThat(mutation.get(10, TimeUnit.SECONDS).accountWeekUsd()).isZero();
            assertThat(original.maxCostUsd()).isEqualByComparingTo(CAP);
            assertThat(reserve(user, run)).isEqualTo(original);
            assertThat(held("ACCOUNT_WEEK", user)).isEqualByComparingTo(CAP);
            assertThatThrownBy(() -> reserve(user, UUID.randomUUID())).isInstanceOf(PlatformSpendExhaustedException.class);
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void admissionWaitsForAdminTransactionAndUsesItsCommittedBudgetOrModelGate(boolean changeModel) throws Exception {
        UUID user = account();
        var changed = new CountDownLatch(1);
        var commit = new CountDownLatch(1);
        var admissionStarted = new CountDownLatch(1);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var mutation = pool.submit(() -> tx.executeWithoutResult(transaction -> {
                if (changeModel) adminService.changeModel(admin, Provider.OPENAI, MODEL, BigDecimal.ZERO, true, 0L);
                else adminService.changeBudgets(admin, BigDecimal.ZERO, DAY, WEEK, 0L);
                changed.countDown();
                await(commit);
            }));
            Future<?> admission;
            try {
                assertThat(changed.await(10, TimeUnit.SECONDS)).isTrue();
                admission = pool.submit(() -> {
                    admissionStarted.countDown();
                    return reserve(user, UUID.randomUUID());
                });
                assertThat(admissionStarted.await(10, TimeUnit.SECONDS)).isTrue();
                assertThatThrownBy(() -> admission.get(250, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
            } finally { commit.countDown(); }
            mutation.get(10, TimeUnit.SECONDS);
            assertThatThrownBy(() -> admission.get(10, TimeUnit.SECONDS)).isInstanceOf(ExecutionException.class)
                .hasCauseInstanceOf(changeModel ? PlatformSpendUnavailableException.class : PlatformSpendExhaustedException.class);
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_reservation", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_bucket", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app.platform_spend_admin_audit", Integer.class)).isOne();
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void adminGrantAndAccountCannotBeRevokedMidwayThroughAnAuthorizedTransaction(boolean disableAccount) {
        String revoke = disableAccount
            ? "UPDATE app.user_account SET status='DISABLED' WHERE id=?"
            : "UPDATE app.platform_admin_grant SET revoked_at=clock_timestamp() WHERE user_id=?";
        try (var pool = Executors.newSingleThreadExecutor()) {
            tx.executeWithoutResult(transaction -> {
                var before = adminService.settings(admin);
                var competingRevocation = pool.submit(() -> new TransactionTemplate(manager).executeWithoutResult(other -> {
                    jdbc.execute("SET LOCAL lock_timeout='150ms'");
                    jdbc.update(revoke, admin);
                }));
                assertThatThrownBy(() -> competingRevocation.get(5, TimeUnit.SECONDS))
                    .isInstanceOf(ExecutionException.class).hasCauseInstanceOf(DataAccessException.class);
                assertThat(adminService.changeBudgets(admin, new BigDecimal("2"), DAY, WEEK, before.revision()).revision())
                    .isEqualTo(before.revision() + 1);
            });
        }
        jdbc.update(revoke, admin);
        assertForbiddenAndUnchanged(admin);
    }

    private int competingChange(PlatformSpendAdminService service, BigDecimal accountBudget,
                                CountDownLatch ready, CountDownLatch start) {
        ready.countDown();
        await(start);
        try {
            tx.executeWithoutResult(transaction -> service.changeBudgets(admin, accountBudget, DAY, WEEK, 0L));
            return 200;
        } catch (ResponseStatusException rejected) {
            return rejected.getStatusCode().value();
        }
    }

    private void assertAudit(Map<String, Object> audit, String action, long previous, long next) {
        assertThat(audit.get("id")).isInstanceOf(UUID.class);
        assertThat(audit.get("actor_user_id")).isEqualTo(admin);
        assertThat(audit.get("action")).isEqualTo(action);
        assertThat((String) audit.get("target")).isNotBlank();
        assertThat(((Number) audit.get("previous_revision")).longValue()).isEqualTo(previous);
        assertThat(((Number) audit.get("new_revision")).longValue()).isEqualTo(next);
        assertThat(audit.get("created_at")).isNotNull();
    }

    private void assertForbiddenAndUnchanged(UUID actor) {
        var before = state();
        status(403, () -> adminService.settings(actor));
        status(403, () -> adminService.changeBudgets(actor, BigDecimal.ZERO, DAY, WEEK, 0L));
        status(403, () -> adminService.changeModel(actor, Provider.OPENAI, MODEL, BigDecimal.ZERO, false, 0L));
        assertThat(state()).isEqualTo(before);
    }

    private static void status(int status, ThrowingCallable action) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ResponseStatusException.class,
            rejected -> assertThat(rejected.getStatusCode().value()).isEqualTo(status));
    }

    private PlatformBudget reserve(UUID user, UUID run) {
        return tx.execute(transaction -> spend.reserve(user, run, LUNA));
    }

    private void synchronizeKnownAndUnknownAttempts(UUID runId, UUID user, String model, String tariff, Instant observed) {
        var run = new AgentRunEntity(runId, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), user,
            Provider.OPENAI, model, AgentRunStatus.RUNNING, observed);
        var knownCost = new BigDecimal(model.equals("gpt-6-luna") ? ".00035" : ".0008");
        var calls = List.of(
            new ProviderCallUsage(UUID.randomUUID(), Provider.OPENAI, model, "responses.create", 1000, 500, 0, 0,
                knownCost, new BigDecimal(".01"), true, "PLATFORM"),
            new ProviderCallUsage(UUID.randomUUID(), Provider.OPENAI, model, "responses.create", 1000, 500, 0, 0,
                BigDecimal.ZERO, new BigDecimal(".01"), false, "PLATFORM"));
        var report = new AgentRunView.AgentRunUsage(RequestTier.SINGLE_AGENT, 2, 0, 2000, 1000, 0, 0, 0, 0, 1,
            calls, knownCost, runId, tariff, false);
        usage.synchronize(run, new AgentRunView(runId, AgentRunStatus.RUNNING, null, null, null, null, null, report, observed));
    }

    private BigDecimal held(String scope, UUID subject) {
        return jdbc.queryForObject("SELECT held_usd FROM app.platform_spend_bucket WHERE scope=? AND subject_id=?",
            BigDecimal.class, scope, subject);
    }

    private UUID account() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO app.user_account(id,external_subject,email,status) VALUES (?,?,?,'ACTIVE')",
            id, "spend-admin-test:" + id, id + "@example.invalid");
        return id;
    }

    private void grant(UUID actor, String capability) {
        jdbc.update("INSERT INTO app.platform_admin_grant(user_id,capability) VALUES (?,?)", actor, capability);
    }

    private Map<String, List<Map<String, Object>>> state() {
        var state = rows("platform_spend_settings", "platform_spend_model_cap", "platform_spend_admin_audit");
        state.putAll(moneyState());
        state.putAll(creditState());
        return state;
    }

    private Map<String, List<Map<String, Object>>> moneyState() {
        return rows("platform_spend_reservation", "platform_spend_settlement", "platform_spend_bucket", "platform_provider_attempt");
    }

    private Map<String, List<Map<String, Object>>> creditState() {
        return rows("weekly_credit_settings", "weekly_credit_model_rate", "weekly_credit_bucket", "weekly_credit_reservation",
            "weekly_credit_admin_audit");
    }

    private Map<String, List<Map<String, Object>>> rows(String... tables) {
        Map<String, List<Map<String, Object>>> result = new LinkedHashMap<>();
        for (String table : tables) result.put(table, jdbc.queryForList("SELECT * FROM app." + table + " ORDER BY 1,2,3"));
        return result;
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
