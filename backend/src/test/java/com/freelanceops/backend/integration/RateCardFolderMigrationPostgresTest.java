package com.freelanceops.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

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

/** 운영과 같은 V50 업그레이드에서 기존 단가·견적 참조를 보존하는지 확인한다. */
@Testcontainers
@Timeout(120)
class RateCardFolderMigrationPostgresTest {
    @Container
    static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer(
                    DockerImageName.parse("pgvector/pgvector:pg17")
                            .asCompatibleSubstituteFor("postgres"));

    @Test
    void upgradesV50WithoutChangingLegacyRatesOrQuotationSnapshots() throws Exception {
        var legacy = configure().target("50").load();
        legacy.migrate();
        UUID user = UUID.randomUUID();
        UUID workspace = UUID.randomUUID();
        UUID rate = UUID.randomUUID();
        UUID project = UUID.randomUUID();
        UUID quotation = UUID.randomUUID();
        UUID assumption = UUID.randomUUID();
        try (var connection = connection()) {
            execute(connection, "INSERT INTO app.user_account(id,external_subject,email,status) VALUES (?,?,?,'ACTIVE')",
                    user, user.toString(), user + "@example.invalid");
            execute(connection, "INSERT INTO app.workspace(id,name,slug,status,created_by) VALUES (?,'Legacy folder fixture',?,'ACTIVE',?)",
                    workspace, "legacy-folders-" + workspace, user);
            execute(connection, """
                    INSERT INTO app.rate_card(id,workspace_id,name,unit,rate,minimum_amount,currency,active,created_by,created_at,updated_at,version)
                    VALUES (?,?,'Preserved legacy rate','DAY',123456.78,999.25,'KRW',FALSE,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,7)
                    """, rate, workspace, user);
            execute(connection, "INSERT INTO app.project(id,workspace_id,title,requirement_text,currency,status,created_by) VALUES (?,?,'Legacy quotation','Synthetic','KRW','LEAD',?)",
                    project, workspace, user);
            execute(connection, """
                    INSERT INTO app.quotation(id,workspace_id,project_id,series_id,version_number,scenario,status,currency,
                      subtotal,discount_total,risk_buffer_rate,risk_buffer_amount,tax_rate,tax_amount,total,created_by,created_at,updated_at)
                    VALUES (?,?,?,?,1,'RECOMMENDED','DRAFT','KRW',123456.78,0,0,0,0,0,123456.78,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
                    """, quotation, workspace, project, quotation, user);
            execute(connection, "INSERT INTO app.quotation_assumption(id,workspace_id,quotation_id,content,created_at) VALUES (?,?,?,'Legacy basis',CURRENT_TIMESTAMP)",
                    assumption, workspace, quotation);
            execute(connection, """
                    INSERT INTO app.quotation_item(id,workspace_id,quotation_id,rate_card_id,title,quantity,unit,unit_rate,
                      subtotal,discount_rate,discount_amount,total,assumption_id,sort_order,created_at)
                    VALUES (gen_random_uuid(),?,?,?,'Legacy item',1,'DAY',123456.78,123456.78,0,0,123456.78,?,0,CURRENT_TIMESTAMP)
                    """, workspace, quotation, rate, assumption);
        }

        var current = configure().target("51").load();
        assertThat(current.migrate().migrationsExecuted).isEqualTo(1);
        current.validate();
        try (var connection = connection()) {
            assertThat(count(connection, "SELECT count(*) FROM app.rate_card WHERE id=? AND folder_id IS NULL AND name='Preserved legacy rate' AND unit='DAY' AND rate=123456.78 AND minimum_amount=999.25 AND NOT active AND version=7", rate)).isEqualTo(1);
            assertThat(count(connection, "SELECT count(*) FROM app.quotation_item WHERE quotation_id=? AND rate_card_id=? AND unit_rate=123456.78 AND total=123456.78", quotation, rate)).isEqualTo(1);
            assertThat(count(connection, "SELECT count(*) FROM app.quotation WHERE id=? AND total=123456.78 AND version_number=1", quotation)).isEqualTo(1);
            assertThat(count(connection, "SELECT count(*) FROM app.rate_card_folder")).isZero();
        }
        assertThat(current.migrate().migrationsExecuted).isZero();
        current.validate();
    }

    private static org.flywaydb.core.api.configuration.FluentConfiguration configure() {
        return Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .schemas("app")
                .defaultSchema("app")
                .createSchemas(true);
    }

    private static Connection connection() throws SQLException {
        return DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    private static void execute(Connection connection, String sql, Object... values) throws SQLException {
        try (var statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < values.length; index++) statement.setObject(index + 1, values[index]);
            statement.executeUpdate();
        }
    }

    private static long count(Connection connection, String sql, Object... values) throws SQLException {
        try (var statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < values.length; index++) statement.setObject(index + 1, values[index]);
            try (var result = statement.executeQuery()) {
                result.next();
                return result.getLong(1);
            }
        }
    }
}
