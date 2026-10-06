package com.freelanceops.backend.migration;

import org.junit.jupiter.api.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.assertj.core.api.Assertions.assertThat;

class PlatformSpendAdminMigrationTest {
    @Test void migrationAddsRevisionAuditAndZeroCapWithoutChangingMoneyOrEnablingSpending() throws Exception {
        String sql = Files.readString(Path.of("src/main/resources/db/migration/V48__platform_spend_admin_controls.sql"));
        String statements = sql.replaceAll("(?m)--.*$", "").toUpperCase(java.util.Locale.ROOT);
        assertThat(statements).contains("ADD COLUMN REVISION BIGINT NOT NULL DEFAULT 0", "ADD COLUMN UPDATED_AT",
            "CHECK (MAX_RUN_USD >= 0 AND MAX_RUN_USD <= 100)", "CREATE TABLE APP.PLATFORM_SPEND_ADMIN_AUDIT",
            "BEFORE UPDATE OR DELETE ON APP.PLATFORM_SPEND_ADMIN_AUDIT");
        assertThat(statements).doesNotContain("UPDATE APP.", "DELETE FROM", "TRUNCATE", "INSERT INTO", "SPENDING_ENABLED",
            "ALTER TABLE APP.PLATFORM_SPEND_RESERVATION", "ALTER TABLE APP.PLATFORM_SPEND_BUCKET", "ALTER TABLE APP.WEEKLY_CREDIT");
    }
}
