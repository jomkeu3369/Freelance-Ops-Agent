package com.freelanceops.backend.domain.identity.dto.response;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 관리자 응답에 필요한 필드만 제공하고 계정·세션 엔티티를 그대로 반환하지 않는다. */
public final class AdminMemberResponse {
    private AdminMemberResponse() {}

    public record Member(
            UUID id,
            String email,
            String displayName,
            String status,
            boolean emailVerificationRequired,
            Instant emailVerifiedAt,
            Instant joinedAt,
            Instant lastLoginAt) {}

    public record Page<T>(
            List<T> items, long total, int page, int size, Instant recordingStartedAt) {}

    public record Login(UUID id, UUID userId, String method, Instant occurredAt) {}

    public record Summary(
            long totalMembers,
            long activeMembers,
            long pendingVerification,
            long joinedLast7Days,
            long signedInLast7Days,
            Instant recordingStartedAt) {}

    public record Audit(
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
}
