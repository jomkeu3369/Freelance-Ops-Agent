package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.response.CustomAgentPetResponse;

import jakarta.validation.constraints.*;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import tools.jackson.databind.ObjectMapper;

import java.util.*;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class JdbcCustomAgentPetRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public JdbcCustomAgentPetRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public List<CustomAgentPetResponse> listPets(UUID workspace, UUID user) {
        return jdbc.query(
                "SELECT id, profile_json, archived, revision FROM app.custom_agent_pet"
                        + " WHERE workspace_id = ? AND user_id = ? ORDER BY created_at, id",
                (row, n) ->
                        new CustomAgentPetResponse(
                                row.getObject(1, UUID.class),
                                mapper.readValue(row.getString(2), PetProfile.class),
                                row.getBoolean(3),
                                row.getLong(4)),
                workspace,
                user);
    }

    public List<Optional<UUID>> findSelection(UUID workspace, UUID user) {
        return jdbc.query(
                "SELECT pet_id FROM app.custom_agent_pet_selection WHERE workspace_id = ?"
                        + " AND user_id = ?",
                (row, n) -> Optional.ofNullable(row.getObject(1, UUID.class)),
                workspace,
                user);
    }

    public Boolean isGenerationModelEnabled(String generationModel) {
        return jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM app.platform_spend_model_cap"
                        + " WHERE provider='OPENAI' AND model=? AND enabled AND"
                        + " max_run_usd>0)",
                Boolean.class,
                generationModel);
    }

    public List<String> findMutationHashes(UUID workspace, UUID user, UUID id, UUID mutationId) {
        return jdbc.query(
                "SELECT mutation_hash FROM app.custom_agent_pet WHERE workspace_id = ? AND"
                        + " user_id = ? AND id = ? AND mutation_id = ?",
                (row, n) -> row.getString(1),
                workspace,
                user,
                id,
                mutationId);
    }

    public int insertPet(
            UUID id,
            UUID workspace,
            UUID user,
            String serialized,
            UUID mutationId,
            String fingerprint) {
        return jdbc.update(
                """
                            INSERT INTO app.custom_agent_pet(id, workspace_id, user_id, profile_json, mutation_id, mutation_hash)
                            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING
                            """,
                id,
                workspace,
                user,
                serialized,
                mutationId,
                fingerprint);
    }

    public int updatePet(
            String serialized,
            UUID mutationId,
            String fingerprint,
            UUID workspace,
            UUID user,
            UUID id) {
        return jdbc.update(
                """
                    UPDATE app.custom_agent_pet SET profile_json = ?, revision = revision + 1, mutation_id = ?, mutation_hash = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE workspace_id = ? AND user_id = ? AND id = ?
                    """,
                serialized,
                mutationId,
                fingerprint,
                workspace,
                user,
                id);
    }

    public int clearSelectionForPet(UUID workspace, UUID user, UUID id) {
        return jdbc.update(
                "UPDATE app.custom_agent_pet_selection SET pet_id = NULL WHERE"
                        + " workspace_id = ? AND user_id = ? AND pet_id = ?",
                workspace,
                user,
                id);
    }

    public int setArchived(boolean archive, UUID workspace, UUID user, UUID id) {
        return jdbc.update(
                "UPDATE app.custom_agent_pet SET archived = ?, revision = revision + 1,"
                        + " updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND user_id ="
                        + " ? AND id = ?",
                archive,
                workspace,
                user,
                id);
    }

    public int clearSelectionForPetBeforeDelete(UUID workspace, UUID user, UUID id) {
        return jdbc.update(
                "UPDATE app.custom_agent_pet_selection SET pet_id = NULL WHERE workspace_id = ? AND"
                        + " user_id = ? AND pet_id = ?",
                workspace,
                user,
                id);
    }

    public int deletePet(UUID workspace, UUID user, UUID id) {
        return jdbc.update(
                "DELETE FROM app.custom_agent_pet WHERE workspace_id = ? AND user_id = ? AND id ="
                        + " ?",
                workspace,
                user,
                id);
    }

    public List<List<PetProfile>> findRuntimeProfiles(UUID workspace, UUID user) {
        return jdbc.query(
                """
                        SELECT p.profile_json FROM app.custom_agent_pet_selection s
                        LEFT JOIN app.custom_agent_pet p ON p.workspace_id = s.workspace_id AND p.user_id = s.user_id AND p.id = s.pet_id AND NOT p.archived
                        WHERE s.workspace_id = ? AND s.user_id = ?
                        """,
                (row, n) ->
                        row.getString(1) == null
                                ? List.<PetProfile>of()
                                : List.of(mapper.readValue(row.getString(1), PetProfile.class)),
                workspace,
                user);
    }

    public List<PetProfile> findGeneratedProfiles(
            UUID generationId, UUID workspace, UUID user, String requestHash) {
        return jdbc.query(
                """
                        SELECT profile_json FROM app.pet_generation
                        WHERE id=? AND workspace_id=? AND user_id=? AND status='COMPLETED' AND request_hash=?
                        """,
                (row, n) -> mapper.readValue(row.getString(1), PetProfile.class),
                generationId,
                workspace,
                user,
                requestHash);
    }

    public List<CustomAgentPetResponse> findPet(UUID workspace, UUID user, UUID id) {
        return jdbc.query(
                "SELECT id, profile_json, archived, revision FROM app.custom_agent_pet"
                        + " WHERE workspace_id = ? AND user_id = ? AND id = ?",
                (row, n) ->
                        new CustomAgentPetResponse(
                                row.getObject(1, UUID.class),
                                mapper.readValue(row.getString(2), PetProfile.class),
                                row.getBoolean(3),
                                row.getLong(4)),
                workspace,
                user,
                id);
    }

    public Long countActivePets(UUID workspace, UUID user) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM app.custom_agent_pet WHERE workspace_id = ? AND"
                        + " user_id = ? AND NOT archived",
                Long.class,
                workspace,
                user);
    }

    public Long countStoredPets(UUID workspace, UUID user) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM app.custom_agent_pet WHERE workspace_id = ? AND"
                        + " user_id = ?",
                Long.class,
                workspace,
                user);
    }

    public int upsertSelection(UUID workspace, UUID user, UUID id) {
        return jdbc.update(
                "INSERT INTO app.custom_agent_pet_selection(workspace_id, user_id, pet_id) VALUES"
                        + " (?, ?, ?) ON CONFLICT (workspace_id, user_id) DO UPDATE SET pet_id ="
                        + " EXCLUDED.pet_id",
                workspace,
                user,
                id);
    }

    public List<Integer> lockCollection(String lockKey) {
        return jdbc.query(
                "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", (row, n) -> 0, lockKey);
    }
}
