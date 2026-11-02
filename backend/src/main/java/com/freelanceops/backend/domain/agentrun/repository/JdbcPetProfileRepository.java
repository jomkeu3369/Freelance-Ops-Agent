package com.freelanceops.backend.domain.agentrun.repository;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import tools.jackson.databind.ObjectMapper;

import java.util.*;
import java.util.List;
import java.util.UUID;

@Repository
public class JdbcPetProfileRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public JdbcPetProfileRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public List<PetProfile> listProfiles(UUID workspace, UUID user) {
        return jdbc.query(
                "SELECT profile_json FROM app.pet_profile WHERE workspace_id = ? AND user_id = ?",
                (row, n) -> mapper.readValue(row.getString(1), PetProfile.class),
                workspace,
                user);
    }

    public int upsertProfile(UUID workspace, UUID user, String slot, String payload) {
        return jdbc.update(
                """
            INSERT INTO app.pet_profile(workspace_id, user_id, slot, profile_json) VALUES (?, ?, ?, ?)
            ON CONFLICT (workspace_id, user_id, slot) DO UPDATE
            SET profile_json = EXCLUDED.profile_json, updated_at = CURRENT_TIMESTAMP
            """,
                workspace,
                user,
                slot,
                payload);
    }
}
