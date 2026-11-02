package com.freelanceops.backend.domain.agentrun.client.dto.response;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.model.Provider;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.UUID;

@Schema(name = "Output")
public record PetGenerationResponse(
        UUID runId,
        PetProfile profile,
        Provider provider,
        String model,
        long inputTokens,
        long outputTokens) {}
