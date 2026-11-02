package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.request.ComposeCustomAgentPetRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.PixelPetGenerationResponse;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public class JdbcPixelPetGenerationRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public JdbcPixelPetGenerationRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public record Stored(
            PixelPetGenerationResponse value,
            UUID project,
            String fingerprint,
            Instant updatedAt,
            String model,
            ComposeCustomAgentPetRequest input,
            PetProfile previous) {}

    public List<Integer> lockGeneration(String lockKey) {
        return jdbc.query(
                "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", (row, n) -> 0, lockKey);
    }

    public Boolean hasSpendReservation(UUID id) {
        return jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM" + " app.platform_spend_reservation WHERE run_id=?)",
                Boolean.class,
                id);
    }

    public Long countToday(UUID workspace, UUID user) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM app.pet_generation WHERE"
                        + " workspace_id=? AND user_id=? AND created_at >="
                        + " (date_trunc('day', CURRENT_TIMESTAMP AT TIME"
                        + " ZONE 'UTC') AT TIME ZONE 'UTC')",
                Long.class,
                workspace,
                user);
    }

    public Long countMatchingRequests(UUID workspace, UUID user) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM app.pet_generation WHERE"
                        + " workspace_id=? AND user_id=? AND request_hash"
                        + " IS NOT NULL AND status='REQUESTED' AND"
                        + " updated_at > clock_timestamp() - interval '90"
                        + " seconds'",
                Long.class,
                workspace,
                user);
    }

    public int insertGeneration(
            UUID id,
            UUID workspace,
            UUID user,
            String provider,
            String model,
            UUID projectId,
            UUID petId,
            long expectedRevision,
            String fingerprint,
            String payload,
            String previousPayload) {
        return jdbc.update(
                """
                                            INSERT INTO app.pet_generation(id,workspace_id,user_id,provider,model,project_id,pet_id,expected_revision,request_hash,request_json,previous_json)
                                            VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING
                                            """,
                id,
                workspace,
                user,
                provider,
                model,
                projectId,
                petId,
                expectedRevision,
                fingerprint,
                payload,
                previousPayload);
    }

    public int failGeneration(String state, UUID id, UUID workspace, UUID user) {
        return jdbc.update(
                "UPDATE app.pet_generation SET"
                        + " status=?,error_code='PET_GENERATION_FAILED',updated_at=clock_timestamp()"
                        + " WHERE id=? AND workspace_id=? AND user_id=? AND status='REQUESTED'",
                state,
                id,
                workspace,
                user);
    }

    public List<UUID> findAttemptIds(UUID id) {
        return jdbc.query(
                "SELECT call_id FROM app.platform_provider_attempt WHERE run_id=?",
                (row, n) -> row.getObject(1, UUID.class),
                id);
    }

    public int completeGeneration(
            String serialized,
            long inputTokens,
            long outputTokens,
            UUID id,
            UUID workspace,
            UUID user) {
        return jdbc.update(
                "UPDATE app.pet_generation SET"
                        + " status='COMPLETED',profile_json=?,input_tokens=?,output_tokens=?,error_code=NULL,updated_at=clock_timestamp()"
                        + " WHERE id=? AND workspace_id=? AND user_id=?",
                serialized,
                inputTokens,
                outputTokens,
                id,
                workspace,
                user);
    }

    public List<Stored> findGeneration(UUID id, UUID workspace, UUID user, boolean lock) {
        return jdbc.query(
                "SELECT"
                        + " project_id,request_hash,status,profile_json,error_code,updated_at,model,request_json,previous_json"
                        + " FROM app.pet_generation WHERE id=? AND workspace_id=? AND user_id=?"
                        + " AND request_hash IS NOT NULL"
                        + (lock ? " FOR UPDATE" : ""),
                (row, n) ->
                        new Stored(
                                new PixelPetGenerationResponse(
                                        id,
                                        row.getString(3),
                                        row.getString(4) == null
                                                ? null
                                                : mapper.readValue(
                                                        row.getString(4), PetProfile.class),
                                        row.getString(5)),
                                row.getObject(1, UUID.class),
                                row.getString(2),
                                row.getTimestamp(6).toInstant(),
                                row.getString(7),
                                mapper.readValue(
                                        row.getString(8), ComposeCustomAgentPetRequest.class),
                                row.getString(9) == null
                                        ? null
                                        : mapper.readValue(row.getString(9), PetProfile.class)),
                id,
                workspace,
                user);
    }
}
