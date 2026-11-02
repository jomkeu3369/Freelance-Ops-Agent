package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.dto.response.PlatformModelCapResponse;
import com.freelanceops.backend.domain.agentrun.model.Provider;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public class JdbcPlatformSpendAdminRepository {
    private final JdbcTemplate jdbc;

    public JdbcPlatformSpendAdminRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record SettingsRow(
            BigDecimal accountWeekUsd,
            BigDecimal globalDayUsd,
            BigDecimal globalWeekUsd,
            long revision,
            Instant updatedAt) {}

    public int updateBudgets(
            BigDecimal accountWeekUsd, BigDecimal globalDayUsd, BigDecimal globalWeekUsd) {
        return jdbc.update(
                """
            UPDATE app.platform_spend_settings SET account_week_usd=?,global_day_usd=?,global_week_usd=?,
                revision=revision+1,updated_at=GREATEST(clock_timestamp(),updated_at+INTERVAL '1 microsecond') WHERE id=1
            """,
                accountWeekUsd,
                globalDayUsd,
                globalWeekUsd);
    }

    public int updateModelCap(
            BigDecimal maxRunUsd, Boolean enabled, String provider, String model) {
        return jdbc.update(
                "UPDATE app.platform_spend_model_cap SET max_run_usd=?,enabled=? WHERE provider=? AND model=?",
                maxRunUsd,
                enabled,
                provider,
                model);
    }

    public int incrementRevision() {
        return jdbc.update(
                """
            UPDATE app.platform_spend_settings SET revision=revision+1,
                updated_at=GREATEST(clock_timestamp(),updated_at+INTERVAL '1 microsecond') WHERE id=1
            """);
    }

    public SettingsRow findSettings(boolean write) {
        return jdbc.queryForObject(
                """
            SELECT account_week_usd,global_day_usd,global_week_usd,revision,updated_at
            FROM app.platform_spend_settings WHERE id=1
            """
                        + (write ? " FOR UPDATE" : " FOR SHARE"),
                (row, n) ->
                        new SettingsRow(
                                row.getBigDecimal(1),
                                row.getBigDecimal(2),
                                row.getBigDecimal(3),
                                row.getLong(4),
                                row.getTimestamp(5).toInstant()));
    }

    public List<PlatformModelCapResponse> listModelCaps() {
        return jdbc.query(
                "SELECT provider,model,max_run_usd,enabled FROM app.platform_spend_model_cap ORDER BY provider,model",
                (row, n) ->
                        new PlatformModelCapResponse(
                                Provider.valueOf(row.getString(1)),
                                row.getString(2),
                                row.getBigDecimal(3),
                                row.getBoolean(4)));
    }

    public List<UUID> findAdminGrant(UUID actor) {
        return jdbc.query(
                """
            SELECT g.user_id FROM app.platform_admin_grant g
            JOIN app.user_account a ON a.id=g.user_id AND a.status='ACTIVE' AND NOT a.email_verification_required
            WHERE g.user_id=? AND g.capability='FREE_USAGE_ADMIN' AND g.revoked_at IS NULL
            FOR SHARE OF g,a
            """,
                (row, n) -> row.getObject(1, UUID.class),
                actor);
    }

    public int insertAudit(
            UUID id,
            UUID actor,
            String action,
            String target,
            String previousValue,
            String newValue,
            long before,
            long after) {
        return jdbc.update(
                """
            INSERT INTO app.platform_spend_admin_audit
                (id,actor_user_id,action,target,previous_value,new_value,previous_revision,new_revision)
            VALUES (?,?,?,?,?,?,?,?)
            """,
                id,
                actor,
                action,
                target,
                previousValue,
                newValue,
                before,
                after);
    }
}
