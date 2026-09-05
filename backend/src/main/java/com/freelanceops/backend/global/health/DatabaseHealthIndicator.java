package com.freelanceops.backend.global.health;

import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;

@Component("dbHealthIndicator")
public class DatabaseHealthIndicator implements HealthIndicator {

    private final DataSource dataSource;

    public DatabaseHealthIndicator(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public Health health() {
        // Pool acquisition is bounded separately by Hikari connection-timeout.
        try (Connection connection = dataSource.getConnection()) {
            return connection.isValid(1) ? Health.up().build() : Health.down().build();
        } catch (SQLException | RuntimeException error) {
            // Driver exceptions may contain connection details; publish status only.
            return Health.down().build();
        }
    }
}
