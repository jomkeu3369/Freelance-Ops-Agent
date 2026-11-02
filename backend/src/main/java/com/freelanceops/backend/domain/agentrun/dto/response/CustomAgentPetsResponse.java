package com.freelanceops.backend.domain.agentrun.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;
import java.util.UUID;

@Schema(name = "Collection")
public record CustomAgentPetsResponse(
        List<CustomAgentPetResponse> pets,
        UUID selectedPetId,
        int maxActivePets,
        int maxStoredPets,
        int maxPromptLength,
        int maxPreferenceRequests,
        String generationMode,
        boolean aiGenerationAvailable) {}
