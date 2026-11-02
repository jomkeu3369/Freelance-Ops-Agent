package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.Provider;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.UUID;

@Schema(name = "Connection")
public record AIConnectionResponse(
        UUID id, Provider provider, String model, String maskedKey, Instant updatedAt) {}
