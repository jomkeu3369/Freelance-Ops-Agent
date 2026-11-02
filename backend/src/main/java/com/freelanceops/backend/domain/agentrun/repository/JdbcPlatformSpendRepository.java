package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.PlatformBudget;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Repository
public class JdbcPlatformSpendRepository {
    private final JdbcTemplate jdbc;

    public JdbcPlatformSpendRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Settings(
            BigDecimal lunaRunUsd,
            BigDecimal terraRunUsd,
            BigDecimal accountWeekUsd,
            BigDecimal globalDayUsd,
            BigDecimal globalWeekUsd) {}

    public record Reservation(UUID userId, String provider, String model, PlatformBudget budget) {}

    public Settings lockSettings() {
        return jdbc.queryForObject(
                """
                        SELECT luna_run_usd, terra_run_usd, account_week_usd, global_day_usd, global_week_usd
                        FROM app.platform_spend_settings WHERE id = 1 FOR UPDATE
                        """,
                (row, n) ->
                        new Settings(
                                row.getBigDecimal(1),
                                row.getBigDecimal(2),
                                row.getBigDecimal(3),
                                row.getBigDecimal(4),
                                row.getBigDecimal(5)));
    }

    public List<Reservation> findReservation(UUID runId) {
        return jdbc.query(
                """
                        SELECT user_id, provider, model, max_cost_usd, tariff_version, valid_until
                        FROM app.platform_spend_reservation WHERE run_id = ?
                        """,
                (row, n) ->
                        new Reservation(
                                row.getObject(1, UUID.class),
                                row.getString(2),
                                row.getString(3),
                                new PlatformBudget(
                                        runId,
                                        row.getBigDecimal(4),
                                        row.getString(5),
                                        row.getTimestamp(6).toInstant())),
                runId);
    }

    public Instant databaseTime() {
        Timestamp value = jdbc.queryForObject("SELECT clock_timestamp()", Timestamp.class);
        return value == null ? null : value.toInstant();
    }

    public List<BigDecimal> findEnabledModelCaps(String provider, String model) {
        return jdbc.query(
                """
                        SELECT max_run_usd FROM app.platform_spend_model_cap WHERE provider = ? AND model = ? AND enabled FOR SHARE
                        """,
                (row, n) -> row.getBigDecimal(1),
                provider,
                model);
    }

    public int insertReservation(
            UUID runId,
            UUID userId,
            String provider,
            String model,
            BigDecimal amount,
            String tariffVersion,
            LocalDate periodDay,
            LocalDate periodWeek,
            Instant validUntil) {
        return jdbc.update(
                """
                INSERT INTO app.platform_spend_reservation
                    (run_id, user_id, provider, model, max_cost_usd, tariff_version, day_period, week_period, valid_until)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                runId,
                userId,
                provider,
                model,
                amount,
                tariffVersion,
                Date.valueOf(periodDay),
                Date.valueOf(periodWeek),
                Timestamp.from(validUntil));
    }

    public int insertSettlement(UUID runId, BigDecimal amount) {
        return jdbc.update(
                "INSERT INTO app.platform_spend_settlement(run_id, reserved_usd) VALUES (?, ?)",
                runId,
                amount);
    }

    public List<BigDecimal> findBucket(String scope, UUID subject, LocalDate period) {
        return jdbc.query(
                "SELECT held_usd FROM app.platform_spend_bucket WHERE scope=? AND"
                        + " subject_id=? AND period=?",
                (row, n) -> row.getBigDecimal(1),
                scope,
                subject,
                Date.valueOf(period));
    }

    public int insertBucket(String scope, UUID subject, LocalDate period) {
        return jdbc.update(
                """
                INSERT INTO app.platform_spend_bucket(scope, subject_id, period, held_usd)
                VALUES (?, ?, ?, 0) ON CONFLICT DO NOTHING
                """,
                scope,
                subject,
                Date.valueOf(period));
    }

    public int holdBucket(
            BigDecimal amount, String scope, UUID subject, LocalDate period, BigDecimal limit) {
        return jdbc.update(
                """
                        UPDATE app.platform_spend_bucket SET held_usd = held_usd + ?
                        WHERE scope = ? AND subject_id = ? AND period = ? AND held_usd + ? <= ?
                        """,
                amount,
                scope,
                subject,
                Date.valueOf(period),
                amount,
                limit);
    }
}
