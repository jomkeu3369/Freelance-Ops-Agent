package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.dto.response.FreeUsageModelRateResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.FreeUsageSettingsResponse;
import com.freelanceops.backend.domain.agentrun.model.Provider;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Repository
public class JdbcFreeUsageRepository {
    private final JdbcTemplate jdbc;

    public JdbcFreeUsageRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Reservation(
            UUID userId, LocalDate period, long epoch, String status, int credits) {}

    public int insertWeeklyBucket(UUID user, LocalDate periodStart, long epoch) {
        return jdbc.update(
                "INSERT INTO app.weekly_credit_bucket(user_id, period, epoch) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                user,
                Date.valueOf(periodStart),
                epoch);
    }

    public int reserveWeeklyCredits(
            int credits, UUID user, LocalDate periodStart, long epoch, int limit) {
        return jdbc.update(
                """
            UPDATE app.weekly_credit_bucket SET reserved = reserved + ?
            WHERE user_id = ? AND period = ? AND epoch = ? AND used + reserved <= ? - ?
            """,
                credits,
                user,
                Date.valueOf(periodStart),
                epoch,
                limit,
                credits);
    }

    public int insertWeeklyReservation(
            UUID runId,
            UUID user,
            LocalDate periodStart,
            long epoch,
            int credits,
            String provider,
            String model,
            Instant updatedAt) {
        return jdbc.update(
                """
            INSERT INTO app.weekly_credit_reservation
                (run_id, user_id, period, epoch, status, credits, provider, model, rate_version)
            VALUES (?, ?, ?, ?, 'RESERVED', ?, ?, ?, ?)
            """,
                runId,
                user,
                Date.valueOf(periodStart),
                epoch,
                credits,
                provider,
                model,
                Timestamp.from(updatedAt));
    }

    public List<Reservation> findWeeklyReservation(UUID runId) {
        return jdbc.query(
                """
            SELECT user_id, period, epoch, status, credits FROM app.weekly_credit_reservation WHERE run_id = ? FOR UPDATE
            """,
                (row, n) ->
                        new Reservation(
                                row.getObject(1, UUID.class),
                                row.getDate(2).toLocalDate(),
                                row.getLong(3),
                                row.getString(4),
                                row.getInt(5)),
                runId);
    }

    public int settleWeeklyBucket(
            int credits,
            int consumedCredits,
            UUID userId,
            LocalDate reservationPeriod,
            long epoch) {
        return jdbc.update(
                """
            UPDATE app.weekly_credit_bucket SET reserved = reserved - ?, used = used + ?
            WHERE user_id = ? AND period = ? AND epoch = ? AND reserved >= ?
            """,
                credits,
                consumedCredits,
                userId,
                Date.valueOf(reservationPeriod),
                epoch,
                credits);
    }

    public int settleWeeklyReservation(String target, UUID runId) {
        return jdbc.update(
                "UPDATE app.weekly_credit_reservation SET status = ?, settled_at = CURRENT_TIMESTAMP WHERE run_id = ?",
                target,
                runId);
    }

    public List<Reservation> findLegacyReservation(UUID runId) {
        return jdbc.query(
                """
            SELECT user_id, period, epoch, status FROM app.free_usage_reservation WHERE run_id = ? FOR UPDATE
            """,
                (row, n) ->
                        new Reservation(
                                row.getObject(1, UUID.class),
                                row.getDate(2).toLocalDate(),
                                row.getLong(3),
                                row.getString(4),
                                1),
                runId);
    }

    public int settleLegacyBucket(
            int target, UUID userId, LocalDate reservationPeriod, long epoch) {
        return jdbc.update(
                """
            UPDATE app.free_usage_bucket SET reserved = reserved - 1, used = used + ?
            WHERE user_id = ? AND period = ? AND epoch = ? AND reserved > 0
            """,
                target,
                userId,
                Date.valueOf(reservationPeriod),
                epoch);
    }

    public int settleLegacyReservation(String target, UUID runId) {
        return jdbc.update(
                "UPDATE app.free_usage_reservation SET status = ?, settled_at = CURRENT_TIMESTAMP WHERE run_id = ?",
                target,
                runId);
    }

    public int updateWeeklyLimit(int limit) {
        return jdbc.update(
                "UPDATE app.weekly_credit_settings SET weekly_limit = ?, updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond') WHERE id = 1",
                limit);
    }

    public int incrementEpoch() {
        return jdbc.update(
                """
            UPDATE app.weekly_credit_settings SET epoch = epoch + 1, last_reset_at = clock_timestamp(),
            updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond') WHERE id = 1
            """);
    }

    public Instant databaseTime() {
        Timestamp value = jdbc.queryForObject("SELECT clock_timestamp()", Timestamp.class);
        return value == null ? null : value.toInstant();
    }

    public FreeUsageSettingsResponse findSettings(boolean write, int maxLimit) {
        return jdbc.queryForObject(
                "SELECT weekly_limit, epoch, updated_at, last_reset_at FROM app.weekly_credit_settings WHERE id = 1 "
                        + (write ? "FOR UPDATE" : "FOR SHARE"),
                (row, n) ->
                        new FreeUsageSettingsResponse(
                                row.getInt(1),
                                maxLimit,
                                row.getLong(2),
                                row.getTimestamp(3).toInstant(),
                                row.getTimestamp(4) == null
                                        ? null
                                        : row.getTimestamp(4).toInstant()));
    }

    public List<FreeUsageModelRateResponse> listModelRates() {
        return jdbc.query(
                "SELECT provider, model, credits, enabled FROM app.weekly_credit_model_rate ORDER BY credits, model",
                (row, n) ->
                        new FreeUsageModelRateResponse(
                                Provider.valueOf(row.getString(1)),
                                row.getString(2),
                                row.getInt(3),
                                row.getBoolean(4)));
    }

    public List<int[]> findBucket(UUID user, LocalDate periodStart, long epoch) {
        return jdbc.query(
                "SELECT used, reserved FROM app.weekly_credit_bucket WHERE user_id = ? AND period = ? AND epoch = ?",
                (row, n) -> new int[] {row.getInt(1), row.getInt(2)},
                user,
                Date.valueOf(periodStart),
                epoch);
    }

    public int updateModelRate(int credits, boolean enabled, String provider, String model) {
        return jdbc.update(
                "UPDATE app.weekly_credit_model_rate SET credits = ?, enabled = ? WHERE provider = ? AND model = ?",
                credits,
                enabled,
                provider,
                model);
    }

    public int touchSettings() {
        return jdbc.update(
                "UPDATE app.weekly_credit_settings SET updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond') WHERE id = 1");
    }

    public Boolean isActiveUser(UUID user) {
        return jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM app.user_account WHERE id = ? AND status = 'ACTIVE')",
                Boolean.class,
                user);
    }

    public Boolean canManage(UUID user) {
        return jdbc.queryForObject(
                """
            SELECT EXISTS(SELECT 1 FROM app.platform_admin_grant grant_row
            JOIN app.user_account account ON account.id = grant_row.user_id AND account.status = 'ACTIVE'
            WHERE grant_row.user_id = ? AND grant_row.capability = 'FREE_USAGE_ADMIN' AND grant_row.revoked_at IS NULL)
            """,
                Boolean.class,
                user);
    }

    public List<UUID> findAdminGrant(UUID user) {
        return jdbc.query(
                """
            SELECT grant_row.user_id FROM app.platform_admin_grant grant_row
            JOIN app.user_account account ON account.id = grant_row.user_id AND account.status = 'ACTIVE'
            WHERE grant_row.user_id = ? AND grant_row.capability = 'FREE_USAGE_ADMIN' AND grant_row.revoked_at IS NULL
            FOR SHARE OF grant_row, account
            """,
                (row, n) -> row.getObject(1, UUID.class),
                user);
    }

    public int insertAudit(
            UUID id,
            UUID actor,
            String action,
            String target,
            String previousValue,
            String newValue,
            long previousEpoch,
            long newEpoch) {
        return jdbc.update(
                """
            INSERT INTO app.weekly_credit_admin_audit
            (id, actor_user_id, action, target, previous_value, new_value, previous_epoch, new_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
                id,
                actor,
                action,
                target,
                previousValue,
                newValue,
                previousEpoch,
                newEpoch);
    }
}
