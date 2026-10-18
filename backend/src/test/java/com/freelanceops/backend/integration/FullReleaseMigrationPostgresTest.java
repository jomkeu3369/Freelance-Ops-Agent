package com.freelanceops.backend.integration;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Full release upgrade on synthetic data; Docker absence is a failure, never a skipped acceptance check. */
@Testcontainers
@Timeout(120)
class FullReleaseMigrationPostgresTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));

    @Test
    void upgradesV35ThroughV49PreservingLegacyDataGrantsAndMonetaryExposure() throws Exception {
        var v35 = configure().target("35").load();
        v35.migrate();
        v35.validate();
        assertThat(v35.info().current().getVersion().toString()).isEqualTo("35");

        UUID owner = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
        try (var connection = connection()) {
            execute(connection, """
                INSERT INTO app.user_account(id, external_subject, email, status)
                VALUES (?, ?, 'full-upgrade@example.invalid', 'ACTIVE')
                """, owner, "full-upgrade-" + owner);
            execute(connection, """
                INSERT INTO app.workspace(id, name, slug, status, created_by)
                VALUES (?, 'Synthetic V35 workspace', ?, 'ACTIVE', ?)
                """, workspace, "full-upgrade-" + workspace, owner);
            execute(connection, """
                INSERT INTO app.project(id, workspace_id, title, requirement_text, currency, status, created_by, version)
                VALUES (?, ?, 'Preserved V35 project', 'Synthetic original input', 'KRW', 'LEAD', ?, 7)
                """, project, workspace, owner);
        }

        var v37 = configure().target("37").load();
        assertThat(v37.migrate().migrationsExecuted).isEqualTo(2);
        v37.validate();
        try (var connection = connection()) {
            assertThat(scalar(connection, "SELECT count(*) FROM app.platform_admin_grant")).isZero();
            // Only a synthetic grant in this disposable DB; V39 must retain it while changing the primary key.
            execute(connection, "INSERT INTO app.platform_admin_grant(user_id, capability) VALUES (?, 'FREE_USAGE_ADMIN')", owner);
        }

        var v39 = configure().target("39").load();
        assertThat(v39.migrate().migrationsExecuted).isEqualTo(2);
        v39.validate();
        assertThat(v39.info().current().getVersion().toString()).isEqualTo("39");

        try (var connection = connection()) {
            assertThat(scalar(connection, """
                SELECT count(*) FROM app.project
                WHERE id = ? AND workspace_id = ? AND created_by = ? AND version = 7
                  AND title = 'Preserved V35 project' AND requirement_text = 'Synthetic original input'
                  AND currency = 'KRW' AND status = 'LEAD'
                """, project, workspace, owner)).isEqualTo(1);
            assertThat(scalar(connection, """
                SELECT count(*) FROM app.user_account
                WHERE id = ? AND status = 'ACTIVE' AND email = 'full-upgrade@example.invalid'
                  AND email_verification_required = FALSE AND email_verified_at IS NULL
                  AND email_verification_token_hash IS NULL AND email_verification_expires_at IS NULL
                  AND email_verification_daily_count = 0
                """, owner)).isEqualTo(1);
            assertThat(scalar(connection, """
                SELECT count(*) FROM app.workspace
                WHERE id = ? AND created_by = ? AND name = 'Synthetic V35 workspace' AND status = 'ACTIVE'
                """, workspace, owner)).isEqualTo(1);
            assertThat(scalar(connection, """
                SELECT count(*) FROM app.flyway_schema_history
                WHERE version IN ('36', '37', '38', '39') AND success
                """)).isEqualTo(4);
            assertThat(scalar(connection, """
                SELECT count(*) FROM information_schema.tables
                WHERE table_schema = 'app' AND table_name IN (
                  'estimation_policy_proposal', 'free_usage_settings', 'platform_admin_grant',
                  'free_usage_bucket', 'free_usage_reservation', 'agent_start_idempotency', 'free_usage_admin_audit',
                  'service_notice', 'notice_campaign', 'notice_delivery', 'notice_admin_audit')
                """)).isEqualTo(11);
            assertThat(scalar(connection, "SELECT count(*) FROM app.free_usage_settings WHERE id = 1 AND monthly_limit = 5 AND epoch = 0"))
                .isEqualTo(1);
            assertThat(scalar(connection, "SELECT count(*) FROM app.free_usage_bucket")).isZero();
            assertThat(scalar(connection, "SELECT count(*) FROM app.free_usage_reservation")).isZero();
            assertThat(scalar(connection, "SELECT count(*) FROM app.platform_admin_grant")).isEqualTo(1);
            assertThat(scalar(connection, "SELECT count(*) FROM app.platform_admin_grant WHERE user_id = ? AND capability = 'FREE_USAGE_ADMIN'", owner))
                .isEqualTo(1);
            assertThat(scalar(connection, "SELECT count(*) FROM app.service_notice")).isZero();
            assertThat(scalar(connection, "SELECT count(*) FROM app.notice_campaign")).isZero();
            // The changed V39 primary key supports two separately assigned capabilities for one synthetic account.
            execute(connection, "INSERT INTO app.platform_admin_grant(user_id, capability) VALUES (?, 'NOTICES_ADMIN')", owner);
            assertThat(scalar(connection, "SELECT count(*) FROM app.platform_admin_grant WHERE user_id = ?", owner)).isEqualTo(2);
        }
        var v48 = configure().target("48").load();
        v48.migrate();
        v48.validate();
        UUID reservation = UUID.randomUUID();
        try (var connection = connection()) {
            execute(connection, "UPDATE app.platform_spend_settings SET account_week_usd=12345678901.12345678, global_day_usd=0, global_week_usd=100.00000001 WHERE id=1");
            execute(connection, "UPDATE app.platform_spend_model_cap SET max_run_usd=0.00000001, enabled=FALSE WHERE provider='OPENAI' AND model='gpt-6-luna'");
            execute(connection, "INSERT INTO app.platform_spend_bucket(scope,subject_id,period,held_usd) VALUES ('ACCOUNT_WEEK',?,'2026-10-12',0.23456789)", owner);
            execute(connection, """
                INSERT INTO app.platform_spend_reservation(run_id,user_id,provider,model,max_cost_usd,tariff_version,day_period,week_period,valid_until)
                VALUES (?,?,'OPENAI','gpt-6-luna',0.23456789,'preserved-upgrade-test','2026-10-18','2026-10-12','2026-10-19T00:00:00Z')
                """, reservation, owner);
        }
        var latest = configure().target("49").load();
        assertThat(latest.migrate().migrationsExecuted).isEqualTo(1);
        latest.validate();
        try (var connection = connection()) {
            assertThat(scalar(connection, "SELECT count(*) FROM app.platform_spend_settings WHERE id=1 AND account_week_usd=12345678901.12345678 AND global_day_usd=0 AND global_week_usd=100.00000001 AND revision=0 AND updated_at IS NOT NULL")).isEqualTo(1);
            assertThat(scalar(connection, "SELECT count(*) FROM app.platform_spend_model_cap WHERE provider='OPENAI' AND model='gpt-6-luna' AND max_run_usd=0.00000001 AND NOT enabled")).isEqualTo(1);
            assertThat(scalar(connection, "SELECT count(*) FROM app.platform_spend_bucket WHERE subject_id=? AND held_usd=0.23456789", owner)).isEqualTo(1);
            assertThat(scalar(connection, "SELECT count(*) FROM app.platform_spend_reservation WHERE run_id=? AND max_cost_usd=0.23456789 AND tariff_version='preserved-upgrade-test'", reservation)).isEqualTo(1);
            assertThat(scalar(connection, "SELECT count(*) FROM app.platform_admin_grant WHERE user_id=?", owner)).isEqualTo(2);
            assertThat(scalar(connection, "SELECT count(*) FROM app.platform_spend_admin_audit")).isZero();
        }
        assertThat(latest.migrate().migrationsExecuted).isZero();
        latest.validate();
    }

    private static org.flywaydb.core.api.configuration.FluentConfiguration configure() {
        return Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
            .locations("classpath:db/migration").schemas("app").defaultSchema("app").createSchemas(true);
    }

    private static Connection connection() throws SQLException {
        return DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    private static void execute(Connection connection, String sql, Object... values) throws SQLException {
        try (var statement = connection.prepareStatement(sql)) {
            for (int i = 0; i < values.length; i++) statement.setObject(i + 1, values[i]);
            statement.executeUpdate();
        }
    }

    private static long scalar(Connection connection, String sql, Object... values) throws SQLException {
        try (var statement = connection.prepareStatement(sql)) {
            for (int i = 0; i < values.length; i++) statement.setObject(i + 1, values[i]);
            try (var rows = statement.executeQuery()) {
                if (!rows.next()) throw new SQLException("Expected one count row");
                return rows.getLong(1);
            }
        }
    }
}
