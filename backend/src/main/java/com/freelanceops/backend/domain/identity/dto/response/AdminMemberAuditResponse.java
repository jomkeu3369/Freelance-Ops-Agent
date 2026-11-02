package com.freelanceops.backend.domain.identity.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.UUID;

@Schema(name = "Audit")
public record AdminMemberAuditResponse(
        UUID id,
        String source,
        UUID actorUserId,
        String action,
        String target,
        String previousValue,
        String newValue,
        long previousEpoch,
        long newEpoch,
        Instant createdAt) {}
