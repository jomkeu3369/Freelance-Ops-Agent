package com.freelanceops.backend.domain.identity.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "user_account", schema = "app")
public class UserAccountEntity {

    @Id
    private UUID id;

    @Column(name = "external_subject", nullable = false, unique = true)
    private String externalSubject;

    @Column(nullable = false, length = 320)
    private String email;

    @Column(name = "display_name", length = 100)
    private String displayName;

    @Column(name = "password_hash", length = 100)
    private String passwordHash;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    private long version;

    protected UserAccountEntity() {
    }

    private UserAccountEntity(UUID id, String email, String displayName, String passwordHash, Instant now) {
        this.id = id;
        this.externalSubject = "local:" + id;
        this.email = email;
        this.displayName = displayName;
        this.passwordHash = passwordHash;
        this.status = "ACTIVE";
        this.createdAt = now;
        this.updatedAt = now;
    }

    public static UserAccountEntity registerLocal(UUID id, String email, String displayName, String passwordHash, Instant now) {
        return new UserAccountEntity(id, email, displayName, passwordHash, now);
    }

    public UUID id() {
        return id;
    }

    public String email() {
        return email;
    }

    public String displayName() {
        return displayName;
    }

    public String passwordHash() {
        return passwordHash;
    }

    public String status() {
        return status;
    }
}
