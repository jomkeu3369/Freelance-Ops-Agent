package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.PetPreferences;
import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.request.ChangeCustomAgentPetRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.ComposeCustomAgentPetRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.CustomAgentPetResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.CustomAgentPetsResponse;
import com.freelanceops.backend.domain.agentrun.repository.JdbcCustomAgentPetRepository;

import jakarta.validation.Validator;
import jakarta.validation.constraints.*;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

@Service
public class CustomAgentPetService {

    private final JdbcCustomAgentPetRepository repository;
    private final AIConnectionService authorization;
    private final ObjectMapper mapper;
    private final PetPromptComposer composer;
    private final Validator validator;
    private final int maxActive;
    private final int maxStored;
    private final int maxPrompt;

    @Value("${platform.ai.spend.enabled:false}")
    private boolean generationEnabled;

    @Value("${app.pets.generation-model:gpt-6.1-sol}")
    private String generationModel;

    public CustomAgentPetService(
            JdbcCustomAgentPetRepository repository,
            AIConnectionService authorization,
            ObjectMapper mapper,
            PetPromptComposer composer,
            Validator validator,
            @Value("${app.pets.max-active:8}") int maxActive,
            @Value("${app.pets.max-stored:24}") int maxStored,
            @Value("${app.pets.max-prompt-length:500}") int maxPrompt) {
        if (maxActive < 1
                || maxActive > 24
                || maxStored < maxActive
                || maxStored > 100
                || maxPrompt < 1
                || maxPrompt > 500)
            throw new IllegalArgumentException("Invalid personal pet limits");
        this.repository = repository;
        this.authorization = authorization;
        this.mapper = mapper;
        this.composer = composer;
        this.validator = validator;
        this.maxActive = maxActive;
        this.maxStored = maxStored;
        this.maxPrompt = maxPrompt;
    }

    public CustomAgentPetsResponse list(UUID user, UUID workspace) {
        authorization.authorize(user, workspace);
        var pets = repository.listPets(workspace, user);
        var selected = repository.findSelection(workspace, user);
        return new CustomAgentPetsResponse(
                pets,
                selected.isEmpty() ? null : selected.getFirst().orElse(null),
                maxActive,
                maxStored,
                maxPrompt,
                6,
                "MODEL_PIXEL",
                generationEnabled
                        && Boolean.TRUE.equals(
                                repository.isGenerationModelEnabled(generationModel)));
    }

    public PetProfile preview(UUID user, UUID workspace, ComposeCustomAgentPetRequest input) {
        authorization.authorize(user, workspace);
        validate(input);
        return compose(user, workspace, input);
    }

    @Transactional
    public CustomAgentPetResponse save(
            UUID user, UUID workspace, ComposeCustomAgentPetRequest input) {
        authorization.authorize(user, workspace);
        validate(input);
        lock(user, workspace);
        String fingerprint = fingerprint(input);
        var replay = repository.findMutationHashes(workspace, user, input.id(), input.mutationId());
        if (!replay.isEmpty()) {
            if (!fingerprint.equals(replay.getFirst()))
                throw failure(HttpStatus.CONFLICT, "PET_REQUEST_REUSED");
            var pet = find(user, workspace, input.id());
            if (pet.archived() || pet.revision() != input.expectedRevision() + 1)
                throw failure(HttpStatus.CONFLICT, "PET_REVISION_CHANGED");
            return pet;
        }
        var profile = compose(user, workspace, input);
        if (!validator.validate(profile).isEmpty())
            throw failure(HttpStatus.UNPROCESSABLE_CONTENT, "PET_INVALID_PROFILE");
        String serialized = mapper.writeValueAsString(profile);
        if (serialized.length() > 12000)
            throw failure(HttpStatus.UNPROCESSABLE_CONTENT, "PET_PROFILE_TOO_LARGE");
        if (input.expectedRevision() == 0) {
            enforceCapacity(user, workspace, true);
            // 식별자를 알아도 다른 사용자나 워크스페이스의 동료를 수정할 수 없다.
            int inserted =
                    repository.insertPet(
                            input.id(),
                            workspace,
                            user,
                            serialized,
                            input.mutationId(),
                            fingerprint);
            if (inserted != 1) throw failure(HttpStatus.CONFLICT, "PET_ID_UNAVAILABLE");
        } else {
            repository.updatePet(
                    serialized, input.mutationId(), fingerprint, workspace, user, input.id());
        }
        // 화면의 저장 후 선택 동작에 맞춰 선택된 개인 동료를 하나만 유지한다.
        select(user, workspace, input.id());
        return find(user, workspace, input.id());
    }

    @Transactional
    public void change(UUID user, UUID workspace, UUID id, ChangeCustomAgentPetRequest input) {
        authorization.authorize(user, workspace);
        if (!validator.validate(input).isEmpty())
            throw failure(HttpStatus.UNPROCESSABLE_CONTENT, "PET_INVALID_CHANGE");
        lock(user, workspace);
        CustomAgentPetResponse pet = find(user, workspace, id);
        if (pet.revision() != input.expectedRevision())
            throw failure(HttpStatus.CONFLICT, "PET_REVISION_CHANGED");
        switch (input.action()) {
            case "SELECT" -> {
                if (pet.archived()) throw failure(HttpStatus.CONFLICT, "PET_ARCHIVED");
                select(user, workspace, id);
            }
            case "ARCHIVE", "RESTORE" -> {
                boolean archive = input.action().equals("ARCHIVE");
                if (pet.archived() == archive) return;
                if (!archive) enforceCapacity(user, workspace, false);
                if (archive) repository.clearSelectionForPet(workspace, user, id);
                repository.setArchived(archive, workspace, user, id);
            }
            default -> throw failure(HttpStatus.UNPROCESSABLE_CONTENT, "PET_INVALID_CHANGE");
        }
    }

    @Transactional
    public void delete(UUID user, UUID workspace, UUID id, long expectedRevision) {
        authorization.authorize(user, workspace);
        lock(user, workspace);
        CustomAgentPetResponse pet = find(user, workspace, id);
        if (pet.revision() != expectedRevision)
            throw failure(HttpStatus.CONFLICT, "PET_REVISION_CHANGED");
        if (!pet.archived()) throw failure(HttpStatus.CONFLICT, "PET_ARCHIVE_BEFORE_DELETE");
        repository.clearSelectionForPetBeforeDelete(workspace, user, id);
        repository.deletePet(workspace, user, id);
    }

    /** Optional이 비어 있으면 기존 계정이며, 빈 목록이 있으면 개인 동료를 선택하지 않은 상태다. */
    public Optional<List<PetProfile>> runtimeProfiles(UUID user, UUID workspace) {
        authorization.authorize(user, workspace);
        var rows = repository.findRuntimeProfiles(workspace, user);
        return rows.stream().findFirst();
    }

    private PetProfile compose(UUID user, UUID workspace, ComposeCustomAgentPetRequest input) {
        if (input.generationId() != null) return generatedProfile(user, workspace, input);
        return composer.compose(
                input.id(), input.description(), generationBase(user, workspace, input));
    }

    PetProfile generationBase(UUID user, UUID workspace, ComposeCustomAgentPetRequest input) {
        validate(input);
        PetProfile base = null;
        if (input.expectedRevision() > 0) {
            var pet = find(user, workspace, input.id());
            if (pet.revision() != input.expectedRevision())
                throw failure(HttpStatus.CONFLICT, "PET_REVISION_CHANGED");
            if (pet.archived()) throw failure(HttpStatus.CONFLICT, "PET_ARCHIVED");
            base = pet.profile();
            if (input.resetPreferences())
                base =
                        new PetProfile(
                                base.slot(),
                                base.name(),
                                base.animal(),
                                base.color(),
                                base.accessory(),
                                base.tone(),
                                base.valuePriority(),
                                base.deliveryPriority(),
                                base.scopePriority(),
                                base.petId(),
                                base.duty(),
                                base.skillMode(),
                                PetPreferences.empty(),
                                base.sprite());
        }
        return base;
    }

    void checkGenerationCapacity(UUID user, UUID workspace, ComposeCustomAgentPetRequest input) {
        lock(user, workspace);
        if (input.expectedRevision() == 0) enforceCapacity(user, workspace, true);
    }

    private PetProfile generatedProfile(
            UUID user, UUID workspace, ComposeCustomAgentPetRequest input) {
        generationBase(user, workspace, input);
        String requestHash =
                fingerprint(
                        new ComposeCustomAgentPetRequest(
                                input.id(),
                                input.mutationId(),
                                input.expectedRevision(),
                                input.description(),
                                input.resetPreferences()));
        return repository
                .findGeneratedProfiles(input.generationId(), workspace, user, requestHash)
                .stream()
                .findFirst()
                .orElseThrow(() -> failure(HttpStatus.CONFLICT, "PET_GENERATION_NOT_READY"));
    }

    private CustomAgentPetResponse find(UUID user, UUID workspace, UUID id) {
        return repository.findPet(workspace, user, id).stream()
                .findFirst()
                .orElseThrow(() -> failure(HttpStatus.NOT_FOUND, "PET_NOT_FOUND"));
    }

    private void validate(ComposeCustomAgentPetRequest input) {
        if (!validator.validate(input).isEmpty() || input.description().length() > maxPrompt)
            throw failure(HttpStatus.UNPROCESSABLE_CONTENT, "PET_INVALID_PROMPT");
    }

    private void enforceCapacity(UUID user, UUID workspace, boolean adding) {
        Long active = repository.countActivePets(workspace, user);
        Long stored = repository.countStoredPets(workspace, user);
        if (active != null && active >= maxActive)
            throw failure(HttpStatus.CONFLICT, "PET_ACTIVE_LIMIT");
        if (adding && stored != null && stored >= maxStored)
            throw failure(HttpStatus.CONFLICT, "PET_STORAGE_LIMIT");
    }

    private void select(UUID user, UUID workspace, UUID id) {
        repository.upsertSelection(workspace, user, id);
    }

    private void lock(UUID user, UUID workspace) {
        repository.lockCollection(workspace + ":custom-pets:" + user);
    }

    String fingerprint(ComposeCustomAgentPetRequest input) {
        try {
            // 기존 클라이언트의 저장 재전송 지문은 선택 필드가 생겨도 유지한다.
            var values = new LinkedHashMap<String, Object>();
            values.put("id", input.id());
            values.put("mutationId", input.mutationId());
            values.put("expectedRevision", input.expectedRevision());
            values.put("description", input.description());
            values.put("resetPreferences", input.resetPreferences());
            if (input.generationId() != null) values.put("generationId", input.generationId());
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(
                                            mapper.writeValueAsString(values)
                                                    .getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    private static ResponseStatusException failure(HttpStatus status, String code) {
        return new ResponseStatusException(status, code);
    }
}
