package com.freelanceops.backend.domain.agentrun.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.dto.response.FreeUsageModelRateResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.FreeUsageSettingsResponse;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.JdbcFreeUsageRepository;
import com.freelanceops.backend.domain.agentrun.repository.JdbcPlatformSpendRepository;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

class JdbcLedgerOrderTest {
    private static final Instant NOW = Instant.parse("2026-10-06T00:00:00Z");
    private static final UUID USER = UUID.randomUUID();
    private static final UUID RUN = UUID.randomUUID();

    @Test
    void monetaryReservationKeepsSettingsLockAndGlobalDayGlobalWeekAccountWeekOrder() {
        List<String> calls = new ArrayList<>();
        JdbcTemplate jdbc =
                mock(
                        JdbcTemplate.class,
                        invocation -> {
                            String sql = invocation.getArgument(0);
                            if (sql.contains("FROM app.platform_spend_settings")) {
                                assertThat(sql).contains("FOR UPDATE");
                                calls.add("lock settings");
                                return new JdbcPlatformSpendRepository.Settings(
                                        BigDecimal.ONE,
                                        BigDecimal.ONE,
                                        BigDecimal.TEN,
                                        BigDecimal.TEN,
                                        BigDecimal.TEN);
                            }
                            if (sql.contains("FROM app.platform_spend_reservation")) {
                                calls.add("read reservation");
                                return List.of();
                            }
                            if (sql.equals("SELECT clock_timestamp()")) {
                                calls.add("clock");
                                return Timestamp.from(NOW);
                            }
                            if (sql.contains("FROM app.platform_spend_model_cap")) {
                                assertThat(sql).contains("FOR SHARE");
                                calls.add("lock model cap");
                                return List.of(BigDecimal.ONE);
                            }
                            if (sql.startsWith("SELECT held_usd")) {
                                calls.add("read " + invocation.getArgument(2));
                                return List.of();
                            }
                            if (sql.contains("INSERT INTO app.platform_spend_bucket"))
                                calls.add("insert " + invocation.getArgument(1));
                            else if (sql.contains("UPDATE app.platform_spend_bucket"))
                                calls.add("hold " + invocation.getArgument(2));
                            else if (sql.contains("INSERT INTO app.platform_spend_reservation"))
                                calls.add("insert reservation");
                            else if (sql.contains("INSERT INTO app.platform_spend_settlement"))
                                calls.add("insert settlement");
                            else throw new AssertionError(sql);
                            return 1;
                        });

        var service = new PlatformSpendService(new JdbcPlatformSpendRepository(jdbc), true);
        var budget =
                service.reserve(
                        USER, RUN, new ModelSelection(Provider.OPENAI, "gpt-5.6-luna", null));

        assertThat(budget.maxCostUsd()).isEqualByComparingTo(BigDecimal.ONE);
        assertThat(calls)
                .containsExactly(
                        "lock settings",
                        "read reservation",
                        "clock",
                        "lock model cap",
                        "read GLOBAL_DAY",
                        "read GLOBAL_WEEK",
                        "read ACCOUNT_WEEK",
                        "insert GLOBAL_DAY",
                        "hold GLOBAL_DAY",
                        "insert GLOBAL_WEEK",
                        "hold GLOBAL_WEEK",
                        "insert ACCOUNT_WEEK",
                        "hold ACCOUNT_WEEK",
                        "insert reservation",
                        "insert settlement");
    }

    @Test
    void creditReservationLocksSettingsBeforeAccountAndWritesBucketBeforeReservation() {
        List<String> calls = new ArrayList<>();
        JdbcTemplate jdbc =
                mock(
                        JdbcTemplate.class,
                        invocation -> {
                            String sql = invocation.getArgument(0);
                            if (sql.contains("FROM app.weekly_credit_settings")) {
                                assertThat(sql).contains("FOR SHARE");
                                calls.add("lock settings");
                                return new FreeUsageSettingsResponse(20, 100000, 3, NOW, null);
                            }
                            if (sql.contains("FROM app.weekly_credit_model_rate")) {
                                calls.add("read rates");
                                return List.of(
                                        new FreeUsageModelRateResponse(
                                                Provider.OPENAI, "gpt-5.6-luna", 2, true));
                            }
                            if (sql.contains("FROM app.user_account")) {
                calls.add("read account");
                                return true;
                            }
                            if (sql.equals("SELECT clock_timestamp()")) {
                                calls.add("clock");
                                return Timestamp.from(NOW);
                            }
                            if (sql.contains("INSERT INTO app.weekly_credit_bucket"))
                                calls.add("insert bucket");
                            else if (sql.contains("UPDATE app.weekly_credit_bucket"))
                                calls.add("reserve bucket");
                            else if (sql.contains("INSERT INTO app.weekly_credit_reservation"))
                                calls.add("insert reservation");
                            else throw new AssertionError(sql);
                            return 1;
                        });

        new FreeUsageService(new JdbcFreeUsageRepository(jdbc))
                .reserve(USER, RUN, Provider.OPENAI, "gpt-5.6-luna");

        assertThat(calls)
                .containsExactly(
                        "lock settings",
                        "read rates",
                "read account",
                        "clock",
                        "insert bucket",
                        "reserve bucket",
                        "insert reservation");
    }

    @Test
    void creditSettlementLocksReservationBeforeUpdatingBucketAndReservationStatus() {
        List<String> calls = new ArrayList<>();
        JdbcTemplate jdbc =
                mock(
                        JdbcTemplate.class,
                        invocation -> {
                            String sql = invocation.getArgument(0);
                            if (sql.contains("SELECT user_id, period, epoch, status, credits")) {
                                assertThat(sql).contains("FOR UPDATE");
                                calls.add("lock reservation");
                                return List.of(
                                        new JdbcFreeUsageRepository.Reservation(
                                                USER,
                                                LocalDate.parse("2026-10-05"),
                                                3,
                                                "RESERVED",
                                                2));
                            }
                            if (sql.contains("UPDATE app.weekly_credit_bucket"))
                                calls.add("settle bucket");
                            else if (sql.contains("UPDATE app.weekly_credit_reservation"))
                                calls.add("settle reservation");
                            else throw new AssertionError(sql);
                            return 1;
                        });

        new FreeUsageService(new JdbcFreeUsageRepository(jdbc))
                .settleConfirmed(RUN, AgentRunStatus.COMPLETED);

        assertThat(calls)
                .containsExactly("lock reservation", "settle bucket", "settle reservation");
    }
}
