package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import jakarta.validation.Validator;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;
import java.util.*;

@Service
public class PetProfileService {
    private final JdbcTemplate jdbc;
    private final AIConnectionService authorization;
    private final ObjectMapper mapper;
    private final Validator validator;

    public PetProfileService(JdbcTemplate jdbc, AIConnectionService authorization, ObjectMapper mapper, Validator validator) {
        this.jdbc = jdbc;
        this.authorization = authorization;
        this.mapper = mapper;
        this.validator = validator;
    }

    public List<PetProfile> list(UUID user, UUID workspace) {
        authorization.authorize(user, workspace);
        var saved = jdbc.query("SELECT profile_json FROM app.pet_profile WHERE workspace_id = ? AND user_id = ?",
            (row, n) -> mapper.readValue(row.getString(1), PetProfile.class), workspace, user);
        return PetProfile.defaults().stream().map(base -> saved.stream().filter(pet -> pet.slot().equals(base.slot())).findFirst().orElse(base)).toList();
    }

    public PetProfile save(UUID user, UUID workspace, PetProfile profile) {
        authorization.authorize(user, workspace);
        validate(profile);
        jdbc.update("""
            INSERT INTO app.pet_profile(workspace_id, user_id, slot, profile_json) VALUES (?, ?, ?, ?)
            ON CONFLICT (workspace_id, user_id, slot) DO UPDATE
            SET profile_json = EXCLUDED.profile_json, updated_at = CURRENT_TIMESTAMP
            """, workspace, user, profile.slot(), mapper.writeValueAsString(profile));
        return profile;
    }

    public void validate(PetProfile profile) {
        if (profile == null || !validator.validate(profile).isEmpty()) throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "Invalid pet profile");
    }
}
