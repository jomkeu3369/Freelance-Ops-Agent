package com.freelanceops.backend.domain.identity.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;

@Schema(name = "Summary")
public record AdminMemberSummaryResponse(
        long totalMembers,
        long activeMembers,
        long pendingVerification,
        long joinedLast7Days,
        long signedInLast7Days,
        Instant recordingStartedAt) {}
