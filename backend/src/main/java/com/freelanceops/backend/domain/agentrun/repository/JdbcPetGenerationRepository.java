package com.freelanceops.backend.domain.agentrun.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public class JdbcPetGenerationRepository {
    private final JdbcTemplate jdbc;

    public JdbcPetGenerationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Integer> lockGeneration(String user) {
        return jdbc.query(
                "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", (row, n) -> 0, user);
    }

    public Long countToday(UUID workspace, UUID user) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM app.pet_generation WHERE workspace_id = ? AND user_id = ? AND created_at >= (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')",
                Long.class,
                workspace,
                user);
    }

    public int insertGeneration(
            UUID id, UUID workspace, UUID user, String provider, String model, UUID credentialId) {
        return jdbc.update(
                "INSERT INTO app.pet_generation(id, workspace_id, user_id, provider, model, credential_id) VALUES (?, ?, ?, ?, ?, ?)",
                id,
                workspace,
                user,
                provider,
                model,
                credentialId);
    }

    public int completeGeneration(
            long inputTokens, long outputTokens, UUID id, UUID workspace, UUID user) {
        return jdbc.update(
                "UPDATE app.pet_generation SET status = 'COMPLETED', input_tokens = ?, output_tokens = ? WHERE id = ? AND workspace_id = ? AND user_id = ?",
                inputTokens,
                outputTokens,
                id,
                workspace,
                user);
    }

    public int failGeneration(UUID id, UUID workspace, UUID user) {
        return jdbc.update(
                "UPDATE app.pet_generation SET status = 'FAILED' WHERE id = ? AND workspace_id = ? AND user_id = ?",
                id,
                workspace,
                user);
    }
}
