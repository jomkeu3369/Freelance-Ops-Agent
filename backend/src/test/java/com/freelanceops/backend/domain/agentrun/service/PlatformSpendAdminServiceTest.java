package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PlatformSpendAdminServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final PlatformSpendAdminService service = new PlatformSpendAdminService(jdbc, new ObjectMapper(), false);
    private final UUID actor = UUID.randomUUID();
    private static final BigDecimal ONE = BigDecimal.ONE;
    private static final PlatformSpendAdminService.ModelCap LUNA = new PlatformSpendAdminService.ModelCap(
        Provider.OPENAI, "gpt-5.6-luna", new BigDecimal("0.1"), true);

    @Test void everyEntryPointRequiresLockedActiveVerifiedLiveGrantBeforeReadingSettings() {
        List<org.assertj.core.api.ThrowableAssert.ThrowingCallable> calls = List.of(
            () -> service.settings(actor), () -> service.changeBudgets(actor, ONE, ONE, ONE, 0L),
            () -> service.changeModel(actor, Provider.OPENAI, LUNA.model(), ONE, true, 0L));
        for (var call : calls) status(call, 403);
        verify(jdbc, times(3)).query(contains("g.capability='FREE_USAGE_ADMIN'"), any(RowMapper.class), eq(actor));
        verifyNoMoreInteractions(jdbc);
    }

    @Test void directServiceCallsRejectInvalidMoneyBeforeQueryingSettings() {
        authorize();
        for (BigDecimal value : new BigDecimal[]{null, new BigDecimal("-0.00000001"), new BigDecimal("0.000000001"),
            new BigDecimal("100000.00000001"), new BigDecimal("1e1000")}) {
            status(() -> service.changeBudgets(actor, value, ONE, ONE, 0L), 400);
            status(() -> service.changeBudgets(actor, ONE, value, ONE, 0L), 400);
            status(() -> service.changeBudgets(actor, ONE, ONE, value, 0L), 400);
        }
        for (BigDecimal value : new BigDecimal[]{null, new BigDecimal("-1"), new BigDecimal("100.00000001"), new BigDecimal("0.000000001")}) {
            status(() -> service.changeModel(actor, Provider.OPENAI, LUNA.model(), value, true, 0L), 400);
        }
        status(() -> service.changeBudgets(actor, ONE, ONE, ONE, null), 400);
        status(() -> service.changeBudgets(actor, ONE, ONE, ONE, -1L), 400);
        status(() -> service.changeModel(actor, Provider.OPENAI, LUNA.model(), ONE, null, 0L), 400);
        verify(jdbc, never()).queryForObject(anyString(), any(RowMapper.class));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void amountsPreserveEightPlacePrecisionAndBoundaryValues() {
        for (BigDecimal value : List.of(BigDecimal.ZERO, new BigDecimal("0.00000001"), new BigDecimal("100000")))
            assertThatCode(() -> PlatformSpendAdminService.validateAmount(value, PlatformSpendAdminService.MAX_BUDGET_USD)).doesNotThrowAnyException();
        assertThatCode(() -> PlatformSpendAdminService.validateAmount(new BigDecimal("100"), PlatformSpendAdminService.MAX_MODEL_RUN_USD))
            .doesNotThrowAnyException();
    }

    @Test void staleBudgetsModelsAndNoOpRequestsNeverMutateOrAudit() {
        authorize(); snapshot(7);
        status(() -> service.changeBudgets(actor, ONE, ONE, ONE, 6L), 409);
        status(() -> service.changeModel(actor, Provider.OPENAI, LUNA.model(), ONE, false, 6L), 409);
        // Even an identical edit must reject the old snapshot token.
        status(() -> service.changeModel(actor, Provider.OPENAI, LUNA.model(), LUNA.maxRunUsd(), true, 6L), 409);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void noOpKeepsRevisionAndDeploymentSwitchWithoutAudit() {
        authorize(); snapshot(3);
        var budgets = service.changeBudgets(actor, ONE, ONE, ONE, 3L);
        var model = service.changeModel(actor, Provider.OPENAI, LUNA.model(), new BigDecimal("0.10000000"), true, 3L);
        assertThat(budgets.revision()).isEqualTo(3);
        assertThat(model.revision()).isEqualTo(3);
        assertThat(budgets.spendingEnabled()).isFalse();
        assertThat(model.spendingEnabled()).isFalse();
        verify(jdbc, never()).update(anyString(), any(Object[].class));
        verify(jdbc, times(2)).queryForObject(contains("FOR UPDATE"), any(RowMapper.class));
    }

    @Test void unknownModelAndExhaustedRevisionCannotMutateOrOverflow() {
        authorize(); snapshot(Long.MAX_VALUE);
        status(() -> service.changeModel(actor, Provider.OPENAI, "unknown-model", ONE, false, Long.MAX_VALUE), 400);
        status(() -> service.changeModel(actor, Provider.OPENAI, LUNA.model(), ONE, false, Long.MAX_VALUE), 409);
        status(() -> service.changeBudgets(actor, BigDecimal.ZERO, ONE, ONE, Long.MAX_VALUE), 409);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void budgetEditAuditsActorPreviousAndNewValuesWithRevisionAndKeepsSwitchOff() {
        authorize();
        when(jdbc.queryForObject(contains("FROM app.platform_spend_settings"), org.mockito.ArgumentMatchers.<RowMapper<PlatformSpendAdminService.Settings>>any()))
            .thenReturn(settings(0, ONE), settings(1, BigDecimal.ZERO));
        models();
        var result = service.changeBudgets(actor, BigDecimal.ZERO, ONE, ONE, 0L);
        assertThat(result.spendingEnabled()).isFalse();
        assertThat(result.revision()).isOne();
        verify(jdbc).update(contains("SET account_week_usd"), eq(BigDecimal.ZERO), eq(ONE), eq(ONE));
        verify(jdbc).update(contains("INSERT INTO app.platform_spend_admin_audit"), any(UUID.class), eq(actor),
            eq("CHANGE_BUDGETS"), eq("budgets"), eq("{\"accountWeekUsd\":1,\"globalDayUsd\":1,\"globalWeekUsd\":1}"),
            eq("{\"accountWeekUsd\":0,\"globalDayUsd\":1,\"globalWeekUsd\":1}"), eq(0L), eq(1L));
    }

    private void authorize() {
        when(jdbc.query(contains("g.capability='FREE_USAGE_ADMIN'"), org.mockito.ArgumentMatchers.<RowMapper<UUID>>any(), eq(actor)))
            .thenReturn(List.of(actor));
    }
    private void snapshot(long revision) {
        when(jdbc.queryForObject(contains("FROM app.platform_spend_settings"), org.mockito.ArgumentMatchers.<RowMapper<PlatformSpendAdminService.Settings>>any()))
            .thenReturn(settings(revision, ONE));
        models();
    }
    private void models() {
        when(jdbc.query(contains("FROM app.platform_spend_model_cap"), org.mockito.ArgumentMatchers.<RowMapper<PlatformSpendAdminService.ModelCap>>any()))
            .thenReturn(List.of(LUNA));
    }
    private PlatformSpendAdminService.Settings settings(long revision, BigDecimal account) {
        return new PlatformSpendAdminService.Settings("USD", account, ONE, ONE, revision, Instant.parse("2026-10-06T00:00:00Z"),
            false, List.of(), PlatformSpendAdminService.MAX_BUDGET_USD, PlatformSpendAdminService.MAX_MODEL_RUN_USD);
    }
    private static void status(org.assertj.core.api.ThrowableAssert.ThrowingCallable call, int status) {
        assertThatThrownBy(call).isInstanceOfSatisfying(ResponseStatusException.class,
            error -> assertThat(error.getStatusCode().value()).isEqualTo(status));
    }
}
