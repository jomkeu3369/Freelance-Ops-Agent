package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.PetPreferences;
import jakarta.validation.Valid;
import jakarta.validation.Validator;
import jakarta.validation.constraints.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

@Service
public class CustomAgentPetService {
    public record Compose(@NotNull UUID id, @NotNull UUID mutationId, @Min(0) long expectedRevision,
        @NotBlank @Size(max = 500) String description, boolean resetPreferences) {}
    public record Pet(UUID id, PetProfile profile, boolean archived, long revision) {}
    public record Collection(List<Pet> pets, UUID selectedPetId, int maxActivePets, int maxStoredPets,
        int maxPromptLength, int maxPreferenceRequests, String generationMode, boolean aiGenerationAvailable) {}
    public record Change(@NotNull @Pattern(regexp = "SELECT|ARCHIVE|RESTORE") String action, @Min(1) long expectedRevision) {}

    private final JdbcTemplate jdbc;
    private final AIConnectionService authorization;
    private final ObjectMapper mapper;
    private final PetPromptComposer composer;
    private final Validator validator;
    private final int maxActive;
    private final int maxStored;
    private final int maxPrompt;

    public CustomAgentPetService(JdbcTemplate jdbc, AIConnectionService authorization, ObjectMapper mapper,
        PetPromptComposer composer, Validator validator,
        @Value("${app.pets.max-active:8}") int maxActive, @Value("${app.pets.max-stored:24}") int maxStored,
        @Value("${app.pets.max-prompt-length:500}") int maxPrompt) {
        if (maxActive < 1 || maxActive > 24 || maxStored < maxActive || maxStored > 100 || maxPrompt < 1 || maxPrompt > 500)
            throw new IllegalArgumentException("Invalid personal pet limits");
        this.jdbc = jdbc; this.authorization = authorization; this.mapper = mapper; this.composer = composer;
        this.validator = validator; this.maxActive = maxActive; this.maxStored = maxStored; this.maxPrompt = maxPrompt;
    }

    public Collection list(UUID user, UUID workspace) {
        authorization.authorize(user, workspace);
        var pets = jdbc.query("SELECT id, profile_json, archived, revision FROM app.custom_agent_pet WHERE workspace_id = ? AND user_id = ? ORDER BY created_at, id",
            (row, n) -> new Pet(row.getObject(1, UUID.class), mapper.readValue(row.getString(2), PetProfile.class), row.getBoolean(3), row.getLong(4)), workspace, user);
        var selected = jdbc.query("SELECT pet_id FROM app.custom_agent_pet_selection WHERE workspace_id = ? AND user_id = ?",
            (row, n) -> Optional.ofNullable(row.getObject(1, UUID.class)), workspace, user);
        return new Collection(pets, selected.isEmpty() ? null : selected.getFirst().orElse(null), maxActive, maxStored, maxPrompt, 6, "RULE_BASED_PREVIEW", false);
    }

    public PetProfile preview(UUID user, UUID workspace, Compose input) {
        authorization.authorize(user, workspace);
        validate(input);
        return compose(user, workspace, input);
    }

    @Transactional
    public Pet save(UUID user, UUID workspace, Compose input) {
        authorization.authorize(user, workspace);
        validate(input);
        lock(user, workspace);
        String fingerprint = fingerprint(input);
        var replay = jdbc.query("SELECT mutation_hash FROM app.custom_agent_pet WHERE workspace_id = ? AND user_id = ? AND id = ? AND mutation_id = ?",
            (row, n) -> row.getString(1), workspace, user, input.id(), input.mutationId());
        if (!replay.isEmpty()) {
            if (!fingerprint.equals(replay.getFirst())) throw failure(HttpStatus.CONFLICT, "PET_REQUEST_REUSED");
            var pet = find(user, workspace, input.id());
            if (pet.archived() || pet.revision() != input.expectedRevision() + 1) throw failure(HttpStatus.CONFLICT, "PET_REVISION_CHANGED");
            return pet;
        }
        var profile = compose(user, workspace, input);
        if (!validator.validate(profile).isEmpty()) throw failure(HttpStatus.UNPROCESSABLE_CONTENT, "PET_INVALID_PROFILE");
        String serialized = mapper.writeValueAsString(profile);
        if (serialized.length() > 12000) throw failure(HttpStatus.UNPROCESSABLE_CONTENT, "PET_PROFILE_TOO_LARGE");
        if (input.expectedRevision() == 0) {
            enforceCapacity(user, workspace, true);
            // A guessed ID must never replace a pet belonging to another user/workspace.
            int inserted = jdbc.update("""
                INSERT INTO app.custom_agent_pet(id, workspace_id, user_id, profile_json, mutation_id, mutation_hash)
                VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING
                """, input.id(), workspace, user, serialized, input.mutationId(), fingerprint);
            if (inserted != 1) throw failure(HttpStatus.CONFLICT, "PET_ID_UNAVAILABLE");
        } else {
            jdbc.update("""
                UPDATE app.custom_agent_pet SET profile_json = ?, revision = revision + 1, mutation_id = ?, mutation_hash = ?, updated_at = CURRENT_TIMESTAMP
                WHERE workspace_id = ? AND user_id = ? AND id = ?
                """, serialized, input.mutationId(), fingerprint, workspace, user, input.id());
        }
        // Saving is explicitly labelled 'save and select' in the UI; only one pet is selected.
        select(user, workspace, input.id());
        return find(user, workspace, input.id());
    }

    @Transactional
    public void change(UUID user, UUID workspace, UUID id, Change input) {
        authorization.authorize(user, workspace);
        if (!validator.validate(input).isEmpty()) throw failure(HttpStatus.UNPROCESSABLE_CONTENT, "PET_INVALID_CHANGE");
        lock(user, workspace);
        Pet pet = find(user, workspace, id);
        if (pet.revision() != input.expectedRevision()) throw failure(HttpStatus.CONFLICT, "PET_REVISION_CHANGED");
        switch (input.action()) {
            case "SELECT" -> {
                if (pet.archived()) throw failure(HttpStatus.CONFLICT, "PET_ARCHIVED");
                select(user, workspace, id);
            }
            case "ARCHIVE", "RESTORE" -> {
                boolean archive = input.action().equals("ARCHIVE");
                if (pet.archived() == archive) return;
                if (!archive) enforceCapacity(user, workspace, false);
                if (archive) jdbc.update("UPDATE app.custom_agent_pet_selection SET pet_id = NULL WHERE workspace_id = ? AND user_id = ? AND pet_id = ?", workspace, user, id);
                jdbc.update("UPDATE app.custom_agent_pet SET archived = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND user_id = ? AND id = ?", archive, workspace, user, id);
            }
            default -> throw failure(HttpStatus.UNPROCESSABLE_CONTENT, "PET_INVALID_CHANGE");
        }
    }

    @Transactional
    public void delete(UUID user, UUID workspace, UUID id, long expectedRevision) {
        authorization.authorize(user, workspace);
        lock(user, workspace);
        Pet pet = find(user, workspace, id);
        if (pet.revision() != expectedRevision) throw failure(HttpStatus.CONFLICT, "PET_REVISION_CHANGED");
        if (!pet.archived()) throw failure(HttpStatus.CONFLICT, "PET_ARCHIVE_BEFORE_DELETE");
        jdbc.update("UPDATE app.custom_agent_pet_selection SET pet_id = NULL WHERE workspace_id = ? AND user_id = ? AND pet_id = ?", workspace, user, id);
        jdbc.update("DELETE FROM app.custom_agent_pet WHERE workspace_id = ? AND user_id = ? AND id = ?", workspace, user, id);
    }

    /** Empty Optional = legacy account; present empty list = explicitly no selected personal pet. */
    public Optional<List<PetProfile>> runtimeProfiles(UUID user, UUID workspace) {
        authorization.authorize(user, workspace);
        var rows = jdbc.query("""
            SELECT p.profile_json FROM app.custom_agent_pet_selection s
            LEFT JOIN app.custom_agent_pet p ON p.workspace_id = s.workspace_id AND p.user_id = s.user_id AND p.id = s.pet_id AND NOT p.archived
            WHERE s.workspace_id = ? AND s.user_id = ?
            """, (row, n) -> row.getString(1) == null ? List.<PetProfile>of() : List.of(mapper.readValue(row.getString(1), PetProfile.class)), workspace, user);
        return rows.stream().findFirst();
    }

    private PetProfile compose(UUID user, UUID workspace, Compose input) {
        PetProfile base = null;
        if (input.expectedRevision() > 0) {
            var pet = find(user, workspace, input.id());
            if (pet.revision() != input.expectedRevision()) throw failure(HttpStatus.CONFLICT, "PET_REVISION_CHANGED");
            if (pet.archived()) throw failure(HttpStatus.CONFLICT, "PET_ARCHIVED");
            base = pet.profile();
            if (input.resetPreferences()) base = new PetProfile(base.slot(), base.name(), base.animal(), base.color(), base.accessory(), base.tone(), base.valuePriority(), base.deliveryPriority(), base.scopePriority(), base.petId(), base.duty(), base.skillMode(), PetPreferences.empty());
        }
        return composer.compose(input.id(), input.description(), base);
    }

    private Pet find(UUID user, UUID workspace, UUID id) {
        return jdbc.query("SELECT id, profile_json, archived, revision FROM app.custom_agent_pet WHERE workspace_id = ? AND user_id = ? AND id = ?",
            (row, n) -> new Pet(row.getObject(1, UUID.class), mapper.readValue(row.getString(2), PetProfile.class), row.getBoolean(3), row.getLong(4)), workspace, user, id)
            .stream().findFirst().orElseThrow(() -> failure(HttpStatus.NOT_FOUND, "PET_NOT_FOUND"));
    }
    private void validate(Compose input) {
        if (!validator.validate(input).isEmpty() || input.description().length() > maxPrompt)
            throw failure(HttpStatus.UNPROCESSABLE_CONTENT, "PET_INVALID_PROMPT");
    }
    private void enforceCapacity(UUID user, UUID workspace, boolean adding) {
        Long active = jdbc.queryForObject("SELECT count(*) FROM app.custom_agent_pet WHERE workspace_id = ? AND user_id = ? AND NOT archived", Long.class, workspace, user);
        Long stored = jdbc.queryForObject("SELECT count(*) FROM app.custom_agent_pet WHERE workspace_id = ? AND user_id = ?", Long.class, workspace, user);
        if (active != null && active >= maxActive) throw failure(HttpStatus.CONFLICT, "PET_ACTIVE_LIMIT");
        if (adding && stored != null && stored >= maxStored) throw failure(HttpStatus.CONFLICT, "PET_STORAGE_LIMIT");
    }
    private void select(UUID user, UUID workspace, UUID id) {
        jdbc.update("INSERT INTO app.custom_agent_pet_selection(workspace_id, user_id, pet_id) VALUES (?, ?, ?) ON CONFLICT (workspace_id, user_id) DO UPDATE SET pet_id = EXCLUDED.pet_id", workspace, user, id);
    }
    private void lock(UUID user, UUID workspace) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", (row, n) -> 0, workspace + ":custom-pets:" + user);
    }
    private String fingerprint(Compose input) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsString(input).getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
    private static ResponseStatusException failure(HttpStatus status, String code) { return new ResponseStatusException(status, code); }
}
