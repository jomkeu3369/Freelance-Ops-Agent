package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.UUID;

@Schema(name = "Generation")
public record PixelPetGenerationResponse(
        UUID id, String status, PetProfile profile, String errorCode) {}
