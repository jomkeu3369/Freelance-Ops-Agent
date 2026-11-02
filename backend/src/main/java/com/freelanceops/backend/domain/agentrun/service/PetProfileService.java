package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.repository.JdbcPetProfileRepository;

import jakarta.validation.Validator;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import tools.jackson.databind.ObjectMapper;

import java.util.*;

@Service
public class PetProfileService {
    private final JdbcPetProfileRepository repository;
    private final AIConnectionService authorization;
    private final ObjectMapper mapper;
    private final Validator validator;
    private final CustomAgentPetService customPets;

    public PetProfileService(
            JdbcPetProfileRepository repository,
            AIConnectionService authorization,
            ObjectMapper mapper,
            Validator validator,
            CustomAgentPetService customPets) {
        this.repository = repository;
        this.authorization = authorization;
        this.mapper = mapper;
        this.validator = validator;
        this.customPets = customPets;
    }

    public List<PetProfile> list(UUID user, UUID workspace) {
        authorization.authorize(user, workspace);
        var custom = customPets.runtimeProfiles(user, workspace);
        if (custom.isPresent()) return custom.get();
        var saved = repository.listProfiles(workspace, user);
        return PetProfile.defaults().stream()
                .map(
                        base ->
                                saved.stream()
                                        .filter(pet -> pet.slot().equals(base.slot()))
                                        .findFirst()
                                        .orElse(base))
                .toList();
    }

    public PetProfile save(UUID user, UUID workspace, PetProfile profile) {
        authorization.authorize(user, workspace);
        validate(profile);
        repository.upsertProfile(
                workspace, user, profile.slot(), mapper.writeValueAsString(profile));
        return profile;
    }

    public void validate(PetProfile profile) {
        if (profile == null || !validator.validate(profile).isEmpty())
            throw new ResponseStatusException(
                    HttpStatus.UNPROCESSABLE_CONTENT, "Invalid pet profile");
    }
}
