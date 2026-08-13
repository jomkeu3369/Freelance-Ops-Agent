package com.freelanceops.backend.domain.identity.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "refresh_token", schema = "app")
public class RefreshTokenEntity {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Column(name = "family_id", nullable = false)
    private UUID familyId;

    @Column(name = "parent_token_id")
    private UUID parentTokenId;

    @Column(name = "replaced_by_token_id")
    private UUID replacedByTokenId;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "revoke_reason", length = 30)
    private String revokeReason;

    @Column(name = "reuse_detected_at")
    private Instant reuseDetectedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Version
    private long version;

    protected RefreshTokenEntity() {
    }

    public RefreshTokenEntity(UUID id, UUID userId, String tokenHash, Instant expiresAt, Instant createdAt) {
        this(id, userId, tokenHash, id, null, expiresAt, createdAt);
    }

    public RefreshTokenEntity(UUID id, UUID userId, String tokenHash, UUID familyId, UUID parentTokenId, Instant expiresAt, Instant createdAt) {
        this.id = id;
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.familyId = familyId;
        this.parentTokenId = parentTokenId;
        this.expiresAt = expiresAt;
        this.createdAt = createdAt;
    }

    public boolean isUsableAt(Instant now) {
        return revokedAt == null && expiresAt.isAfter(now);
    }

    public void revoke(Instant now) {
        revoke(now, "LOGOUT");
    }

    public void rotateTo(UUID replacementId, Instant now) {
        if (revokedAt != null || replacedByTokenId != null) throw new IllegalStateException("refresh token is already consumed");
        replacedByTokenId = replacementId;
        revoke(now, "ROTATED");
    }

    public void revoke(Instant now, String reason) {
        if (revokedAt == null) revokedAt = now;
        if (revokeReason == null || "REUSE_DETECTED".equals(reason)) revokeReason = reason;
    }

    public void markReuseDetected(Instant now) {
        reuseDetectedAt = now;
        revoke(now, "REUSE_DETECTED");
    }

    public UUID userId() {
        return userId;
    }

    public UUID id() { return id; }
    public UUID familyId() { return familyId; }
    public UUID parentTokenId() { return parentTokenId; }
    public UUID replacedByTokenId() { return replacedByTokenId; }
    public Instant revokedAt() { return revokedAt; }
    public String revokeReason() { return revokeReason; }
    public Instant reuseDetectedAt() { return reuseDetectedAt; }
}
