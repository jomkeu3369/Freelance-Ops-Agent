package com.freelanceops.backend.domain.client.entity;

import com.freelanceops.backend.domain.client.model.ClientStatus;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "client", schema = "app")
public class ClientEntity {

    @Id
    private UUID id;
    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;
    @Column(nullable = false, length = 120)
    private String name;
    @Column(name = "company_name", length = 160)
    private String companyName;
    @Column(length = 320)
    private String email;
    @Column(length = 40)
    private String phone;
    @Column(length = 5000)
    private String notes;
    @Column(nullable = false, length = 20)
    private String status;
    @Column(name = "created_by", nullable = false)
    private UUID createdBy;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    @Version
    private long version;

    protected ClientEntity() {
    }

    public ClientEntity(UUID id, UUID workspaceId, String name, String companyName, String email, String phone, String notes, UUID createdBy, Instant now) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.name = name;
        this.companyName = companyName;
        this.email = email;
        this.phone = phone;
        this.notes = notes;
        this.status = ClientStatus.ACTIVE.name();
        this.createdBy = createdBy;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void update(String name, String companyName, String email, String phone, String notes, Instant now) {
        this.name = name;
        this.companyName = companyName;
        this.email = email;
        this.phone = phone;
        this.notes = notes;
        this.updatedAt = now;
    }

    public void archive(Instant now) {
        this.status = ClientStatus.ARCHIVED.name();
        this.updatedAt = now;
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public String name() { return name; }
    public String companyName() { return companyName; }
    public String email() { return email; }
    public String phone() { return phone; }
    public String notes() { return notes; }
    public String status() { return status; }
    public UUID createdBy() { return createdBy; }
    public Instant createdAt() { return createdAt; }
    public Instant updatedAt() { return updatedAt; }
    public long version() { return version; }
}
