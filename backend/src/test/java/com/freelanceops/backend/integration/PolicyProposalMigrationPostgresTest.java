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

import static org.assertj.core.api.Assertions.*;

/** Upgrade a disposable V35 database containing existing tenant data, without Flyway clean. */
@Testcontainers(disabledWithoutDocker = true)
@Timeout(120)
class PolicyProposalMigrationPostgresTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));

    @Test
    void upgradesV35WithoutLosingExistingDataAndEnforcesV36TenantAndStateConstraints() throws Exception {
        var old = configure().target("35").load();
        old.migrate();
        assertThat(old.info().current().getVersion().toString()).isEqualTo("35");
        UUID owner = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
        UUID foreignWorkspace = UUID.randomUUID(), foreignProject = UUID.randomUUID();
        try (var connection = connection()) {
            execute(connection, "INSERT INTO app.user_account(id, external_subject, email, status) VALUES (?, ?, 'synthetic@example.invalid', 'ACTIVE')",
                owner, "migration-" + owner);
            for (var ws : new UUID[]{workspace, foreignWorkspace}) {
                execute(connection, "INSERT INTO app.workspace(id, name, slug, status, created_by) VALUES (?, 'Synthetic pre-upgrade tenant', ?, 'ACTIVE', ?)",
                    ws, "migration-" + ws, owner);
            }
            insertProject(connection, workspace, project, owner);
            insertProject(connection, foreignWorkspace, foreignProject, owner);
        }
        var latest = configure().target("36").load();
        assertThat(latest.migrate().migrationsExecuted).isEqualTo(1);
        latest.validate();
        assertThat(latest.info().current().getVersion().toString()).isEqualTo("36");
        try (var connection = connection()) {
            assertThat(scalar(connection, "SELECT count(*) FROM app.project WHERE title = 'Preserved intake' AND version = 7"))
                .isEqualTo(2);
            assertThat(scalar(connection, "SELECT count(*) FROM pg_indexes WHERE schemaname = 'app' AND indexname IN "
                + "('ix_policy_proposal_workspace_created', 'ix_policy_proposal_project_created')")).isEqualTo(2);
            UUID proposal = UUID.randomUUID(), key = UUID.randomUUID();
            insertProposal(connection, proposal, workspace, project, owner, key);
            assertThatThrownBy(() -> insertProposal(connection, UUID.randomUUID(), workspace, project, owner, key))
                .isInstanceOfSatisfying(SQLException.class, error -> assertThat(error.getSQLState()).isEqualTo("23505"));
            assertThatThrownBy(() -> insertProposal(connection, UUID.randomUUID(), workspace, foreignProject, owner, UUID.randomUUID()))
                .isInstanceOfSatisfying(SQLException.class, error -> assertThat(error.getSQLState()).isEqualTo("23503"));
            assertThatThrownBy(() -> execute(connection, "UPDATE app.estimation_policy_proposal SET status = 'APPLIED' WHERE id = ?", proposal))
                .isInstanceOfSatisfying(SQLException.class, error -> assertThat(error.getSQLState()).isEqualTo("23514"));
            assertThatThrownBy(() -> execute(connection, "UPDATE app.estimation_policy_proposal SET proposed_tax_rate = 1.1 WHERE id = ?", proposal))
                .isInstanceOfSatisfying(SQLException.class, error -> assertThat(error.getSQLState()).isEqualTo("23514"));
            assertThatThrownBy(() -> execute(connection, "UPDATE app.estimation_policy_proposal SET source_message = '  ' WHERE id = ?", proposal))
                .isInstanceOfSatisfying(SQLException.class, error -> assertThat(error.getSQLState()).isEqualTo("23514"));
            execute(connection, "UPDATE app.estimation_policy_proposal SET status = 'APPLIED', applied_at = CURRENT_TIMESTAMP, applied_policy_version = 1 WHERE id = ?", proposal);
            assertThat(scalar(connection, "SELECT count(*) FROM app.estimation_policy_proposal WHERE status = 'APPLIED'"))
                .isEqualTo(1);
            // Cascade belongs to this synthetic project only; the other tenant survives.
            execute(connection, "DELETE FROM app.project WHERE id = ?", project);
            assertThat(scalar(connection, "SELECT count(*) FROM app.estimation_policy_proposal")).isZero();
            assertThat(scalar(connection, "SELECT count(*) FROM app.project")).isEqualTo(1);
        }
        assertThat(latest.migrate().migrationsExecuted).isZero();
    }

    private static org.flywaydb.core.api.configuration.FluentConfiguration configure() {
        return Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
            .locations("classpath:db/migration").schemas("app").defaultSchema("app").createSchemas(true);
    }
    private static Connection connection() throws SQLException {
        return DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }
    private static void insertProject(Connection connection, UUID workspace, UUID project, UUID owner) throws SQLException {
        execute(connection, "INSERT INTO app.project(id, workspace_id, title, requirement_text, currency, status, created_by, version) "
            + "VALUES (?, ?, 'Preserved intake', 'Pre-upgrade original input', 'KRW', 'LEAD', ?, 7)", project, workspace, owner);
    }
    private static void insertProposal(Connection connection, UUID id, UUID workspace, UUID project, UUID owner, UUID key) throws SQLException {
        execute(connection, """
            INSERT INTO app.estimation_policy_proposal (
                id, workspace_id, project_id, source_message, created_by, idempotency_key, confirmation_token,
                base_version, before_tax_rate, before_risk_buffer_rate, before_maximum_discount_rate,
                proposed_tax_rate, proposed_risk_buffer_rate, proposed_maximum_discount_rate, status, created_at, expires_at
            ) VALUES (?, ?, ?, 'Synthetic reviewed change', ?, ?, ?, 0, 0, 0, 0.3, 0.1, 0, 0.3,
                'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 minutes')
            """, id, workspace, project, owner, key, UUID.randomUUID());
    }
    private static void execute(Connection connection, String sql, Object... values) throws SQLException {
        try (var statement = connection.prepareStatement(sql)) {
            for (int i = 0; i < values.length; i++) statement.setObject(i + 1, values[i]);
            statement.executeUpdate();
        }
    }
    private static long scalar(Connection connection, String sql) throws SQLException {
        try (var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
            if (!rows.next()) throw new SQLException("Expected one count row");
            return rows.getLong(1);
        }
    }
}
