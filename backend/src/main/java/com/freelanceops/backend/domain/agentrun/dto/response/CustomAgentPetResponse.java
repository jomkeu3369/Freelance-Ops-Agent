package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.UUID;

@Schema(name = "Pet")
public record CustomAgentPetResponse(
        UUID id, PetProfile profile, boolean archived, long revision) {}
