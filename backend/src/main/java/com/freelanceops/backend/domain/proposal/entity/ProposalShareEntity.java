package com.freelanceops.backend.domain.proposal.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "proposal_share", schema = "app")
public class ProposalShareEntity {

    @Id
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "quotation_id", nullable = false)
    private UUID quotationId;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "created_by", nullable = false)
    private UUID createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected ProposalShareEntity() {
    }

    public ProposalShareEntity(UUID id, UUID workspaceId, UUID quotationId, String tokenHash, Instant expiresAt, UUID createdBy, Instant createdAt) {
        if (!expiresAt.isAfter(createdAt)) throw new IllegalArgumentException("share expiry must be after creation");
        if (tokenHash == null || !tokenHash.matches("^[0-9a-f]{64}$")) {
            throw new IllegalArgumentException("share token hash is invalid");
        }
        this.id = id;
        this.workspaceId = workspaceId;
        this.quotationId = quotationId;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        this.createdBy = createdBy;
        this.createdAt = createdAt;
    }

    public boolean availableAt(Instant now) {
        return revokedAt == null && now.isBefore(expiresAt);
    }

    public void revoke(Instant now) {
        if (revokedAt == null) revokedAt = now;
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID quotationId() { return quotationId; }
    public String tokenHash() { return tokenHash; }
    public Instant expiresAt() { return expiresAt; }
    public Instant revokedAt() { return revokedAt; }
    public UUID createdBy() { return createdBy; }
    public Instant createdAt() { return createdAt; }
}
