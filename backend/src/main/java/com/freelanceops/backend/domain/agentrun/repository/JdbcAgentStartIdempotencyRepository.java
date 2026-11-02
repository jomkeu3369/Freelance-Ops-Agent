package com.freelanceops.backend.domain.agentrun.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public class JdbcAgentStartIdempotencyRepository {
    private final JdbcTemplate jdbc;

    public JdbcAgentStartIdempotencyRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record StartRecord(String requestHash, UUID runId, Instant acceptedAt) {}

    public List<Integer> lockAccount(String userId) {
        return jdbc.query(
                "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                (row, rowNumber) -> 0,
                userId);
    }

    public List<StartRecord> findStart(UUID userId, String idempotencyKey) {
        return jdbc.query(
                """
            SELECT request_hash, run_id, accepted_at FROM app.agent_start_idempotency
            WHERE user_id = ? AND idempotency_key = ?
            """,
                (row, rowNumber) ->
                        new StartRecord(
                                row.getString(1),
                                row.getObject(2, UUID.class),
                                row.getTimestamp(3).toInstant()),
                userId,
                idempotencyKey);
    }

    public int insertStart(
            UUID userId,
            String idempotencyKey,
            String requestHash,
            UUID runId,
            Instant acceptedAt) {
        return jdbc.update(
                """
            INSERT INTO app.agent_start_idempotency (user_id, idempotency_key, request_hash, run_id, accepted_at)
            VALUES (?, ?, ?, ?, ?)
            """,
                userId,
                idempotencyKey,
                requestHash,
                runId,
                Timestamp.from(acceptedAt));
    }
}
