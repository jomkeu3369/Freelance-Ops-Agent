package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.dto.response.AIConnectionResponse;
import com.freelanceops.backend.domain.agentrun.model.Provider;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.*;
import java.util.List;
import java.util.UUID;

@Repository
public class JdbcAIConnectionRepository {
    private final JdbcTemplate jdbc;

    public JdbcAIConnectionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<AIConnectionResponse> listConnections(UUID workspace, UUID user) {
        return jdbc.query(
                "SELECT id, provider, model, masked_key, updated_at FROM app.ai_connection WHERE workspace_id = ? AND user_id = ? ORDER BY provider",
                (row, n) ->
                        new AIConnectionResponse(
                                row.getObject("id", UUID.class),
                                Provider.valueOf(row.getString("provider")),
                                row.getString("model"),
                                row.getString("masked_key"),
                                row.getTimestamp("updated_at").toInstant()),
                workspace,
                user);
    }

    public List<UUID> findConnectionIds(UUID workspace, UUID user, String provider) {
        return jdbc.query(
                "SELECT id FROM app.ai_connection WHERE workspace_id = ? AND user_id = ? AND provider = ?",
                (row, n) -> row.getObject("id", UUID.class),
                workspace,
                user,
                provider);
    }

    public int upsertConnection(
            UUID id,
            UUID workspace,
            UUID user,
            String provider,
            String model,
            String encrypted,
            String masked) {
        return jdbc.update(
                """
            INSERT INTO app.ai_connection(id, workspace_id, user_id, provider, model, ciphertext, masked_key)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET model = EXCLUDED.model, ciphertext = EXCLUDED.ciphertext,
                masked_key = EXCLUDED.masked_key, updated_at = CURRENT_TIMESTAMP
            """,
                id,
                workspace,
                user,
                provider,
                model,
                encrypted,
                masked);
    }

    public int deleteConnection(UUID id, UUID workspace, UUID user) {
        return jdbc.update(
                "DELETE FROM app.ai_connection WHERE id = ? AND workspace_id = ? AND user_id = ?",
                id,
                workspace,
                user);
    }

    public Integer countMatchingConnection(
            UUID id, UUID workspace, UUID user, String provider, String model) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM app.ai_connection WHERE id = ? AND workspace_id = ? AND user_id = ? AND provider = ? AND model = ?",
                Integer.class,
                id,
                workspace,
                user,
                provider,
                model);
    }

    public List<String> findCiphertexts(
            UUID id, UUID workspace, UUID user, String provider, String model) {
        return jdbc.query(
                "SELECT ciphertext FROM app.ai_connection WHERE id = ? AND workspace_id = ? AND user_id = ? AND provider = ? AND model = ?",
                (row, n) -> row.getString(1),
                id,
                workspace,
                user,
                provider,
                model);
    }
}
