package com.freelanceops.backend.domain.identity.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.UUID;

@Schema(name = "Login")
public record AdminMemberLoginResponse(UUID id, UUID userId, String method, Instant occurredAt) {}
