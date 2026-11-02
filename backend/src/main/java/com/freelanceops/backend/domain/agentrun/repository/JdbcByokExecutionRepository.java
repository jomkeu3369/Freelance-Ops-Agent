package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.ByokBudget;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import tools.jackson.databind.ObjectMapper;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public class JdbcByokExecutionRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public JdbcByokExecutionRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public record Scope(ByokBudget budget, boolean closed) {}

    public int insertScope(
            UUID scopeId,
            UUID runId,
            String payload,
            Instant until,
            int maxModelCalls,
            int maxInputTokens,
            int maxOutputTokens) {
        return jdbc.update(
                """
            INSERT INTO app.byok_execution_scope(scope_id,run_id,payload,valid_until,max_model_calls,max_input_tokens,max_output_tokens)
            VALUES (?,?,?::jsonb,?,?,?,?)
            """,
                scopeId,
                runId,
                payload,
                Timestamp.from(until),
                maxModelCalls,
                maxInputTokens,
                maxOutputTokens);
    }

    public int insertAttempt(
            UUID callId, UUID scopeId, String operation, int inputTokens, int maxOutputTokens) {
        return jdbc.update(
                """
            INSERT INTO app.byok_provider_attempt(call_id,scope_id,operation,input_tokens,output_tokens)
            VALUES (?,?,?,?,?) ON CONFLICT (call_id) DO NOTHING
            """,
                callId,
                scopeId,
                operation,
                inputTokens,
                maxOutputTokens);
    }

    public int consumeScope(int inputTokens, int maxOutputTokens, UUID scopeId) {
        return jdbc.update(
                """
            UPDATE app.byok_execution_scope SET model_calls=model_calls+1,input_tokens=input_tokens+?,output_tokens=output_tokens+?
            WHERE scope_id=? AND NOT closed AND valid_until > clock_timestamp()
              AND model_calls < max_model_calls AND input_tokens + ? <= max_input_tokens
              AND output_tokens + ? <= max_output_tokens
            """,
                inputTokens,
                maxOutputTokens,
                scopeId,
                inputTokens,
                maxOutputTokens);
    }

    public int closeScope(UUID runId) {
        return jdbc.update(
                "UPDATE app.byok_execution_scope SET closed=TRUE WHERE run_id=? AND NOT closed",
                runId);
    }

    public Integer countMatchingAttempt(
            UUID callId, UUID scopeId, String operation, long inputTokens, long outputTokens) {
        return jdbc.queryForObject(
                """
                SELECT count(*) FROM app.byok_provider_attempt WHERE call_id=? AND scope_id=? AND operation=?
                AND input_tokens >= ? AND output_tokens >= ?
                """,
                Integer.class,
                callId,
                scopeId,
                operation,
                inputTokens,
                outputTokens);
    }

    public List<Scope> findScope(UUID run, boolean lock) {
        return jdbc.query(
                "SELECT payload::text,closed FROM app.byok_execution_scope WHERE run_id=?"
                        + (lock ? " FOR UPDATE" : ""),
                (row, n) ->
                        new Scope(
                                mapper.readValue(row.getString(1), ByokBudget.class),
                                row.getBoolean(2)),
                run);
    }

    public Instant databaseTime() {
        Timestamp value = jdbc.queryForObject("SELECT clock_timestamp()", Timestamp.class);
        return value == null ? null : value.toInstant();
    }
}
