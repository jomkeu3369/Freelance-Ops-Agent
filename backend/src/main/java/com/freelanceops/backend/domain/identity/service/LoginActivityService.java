package com.freelanceops.backend.domain.identity.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

/** Commits with the issued session; refreshes and failed attempts are deliberately excluded. */
@Service
public class LoginActivityService {
    public enum Method { PASSWORD, REGISTRATION }
    private final JdbcTemplate jdbc;
    public LoginActivityService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Transactional(propagation = Propagation.MANDATORY)
    public void record(UUID userId, Method method, Instant occurredAt) {
        jdbc.update("INSERT INTO app.user_login_event(id,user_id,method,occurred_at) VALUES (?,?,?,?)",
            UUID.randomUUID(), userId, method.name(), Timestamp.from(occurredAt));
    }
}
