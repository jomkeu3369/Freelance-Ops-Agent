package com.freelanceops.backend.domain.agentrun.client.dto.response;

import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.AgentRunUsage;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "Output")
public record PixelPetGenerationResult(PetProfile profile, AgentRunUsage usage) {}
