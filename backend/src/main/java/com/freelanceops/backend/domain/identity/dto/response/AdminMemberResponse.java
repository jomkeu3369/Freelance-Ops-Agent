package com.freelanceops.backend.domain.identity.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.UUID;

@Schema(name = "Member")
public record AdminMemberResponse(
        UUID id,
        String email,
        String displayName,
        String status,
        boolean emailVerificationRequired,
        Instant emailVerifiedAt,
        Instant joinedAt,
        Instant lastLoginAt) {}
