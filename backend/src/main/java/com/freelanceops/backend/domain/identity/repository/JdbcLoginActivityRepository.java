package com.freelanceops.backend.domain.identity.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

@Repository
public class JdbcLoginActivityRepository {
    private final JdbcTemplate jdbc;

    public JdbcLoginActivityRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public int insertActivity(UUID id, UUID userId, String method, Instant occurredAt) {
        return jdbc.update(
                "INSERT INTO app.user_login_event(id,user_id,method,occurred_at) VALUES (?,?,?,?)",
                id,
                userId,
                method,
                Timestamp.from(occurredAt));
    }
}
