package com.freelanceops.backend.global.health;

import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.SQLException;

import javax.sql.DataSource;

@Component("dbHealthIndicator")
public class DatabaseHealthIndicator implements HealthIndicator {

    private final DataSource dataSource;

    public DatabaseHealthIndicator(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public Health health() {
        // 연결 풀 대기 시간은 Hikari의 connection-timeout으로 별도 제한한다.
        try (Connection connection = dataSource.getConnection()) {
            return connection.isValid(1) ? Health.up().build() : Health.down().build();
        } catch (SQLException | RuntimeException error) {
            // 드라이버 예외에 접속 정보가 포함될 수 있으므로 상태만 공개한다.
            return Health.down().build();
        }
    }
}
