package com.freelanceops.backend.domain.project.entity;

import com.freelanceops.backend.domain.project.model.ProjectDeletionInProgressException;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "project", schema = "app")
public class ProjectEntity {

    @Id
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "client_id")
    private UUID clientId;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(name = "requirement_text", nullable = false, length = 50000)
    private String requirementText;

    @Column(nullable = false, length = 3)
    private String currency;

    private LocalDate deadline;

    @Column(name = "budget_min", precision = 19, scale = 2)
    private BigDecimal budgetMin;

    @Column(name = "budget_max", precision = 19, scale = 2)
    private BigDecimal budgetMax;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(name = "created_by", nullable = false)
    private UUID createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "deletion_requested_at")
    private Instant deletionRequestedAt;

    @Version
    private long version;

    protected ProjectEntity() {
    }

    public ProjectEntity(UUID id, UUID workspaceId, String title, String requirementText, String currency, LocalDate deadline, BigDecimal budgetMin, BigDecimal budgetMax) {
        this(id, workspaceId, null, title, requirementText, currency, deadline, budgetMin, budgetMax, "LEAD", UUID.randomUUID(), Instant.now());
    }

    public ProjectEntity(UUID id, UUID workspaceId, UUID clientId, String title, String requirementText, String currency, LocalDate deadline, BigDecimal budgetMin, BigDecimal budgetMax, String status, UUID createdBy, Instant now) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.clientId = clientId;
        this.title = title;
        this.requirementText = requirementText;
        this.currency = currency;
        this.deadline = deadline;
        this.budgetMin = budgetMin;
        this.budgetMax = budgetMax;
        this.status = status;
        this.createdBy = createdBy;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void update(UUID clientId, String title, String requirementText, String currency, LocalDate deadline, BigDecimal budgetMin, BigDecimal budgetMax, String status, Instant now) {
        requireNotDeleting();
        this.clientId = clientId;
        this.title = title;
        this.requirementText = requirementText;
        this.currency = currency;
        this.deadline = deadline;
        this.budgetMin = budgetMin;
        this.budgetMax = budgetMax;
        this.status = status;
        this.updatedAt = now;
    }

    public void requestDeletion(Instant now) {
        if (deletionRequestedAt == null) deletionRequestedAt = now;
    }

    public void requireNotDeleting() {
        if (deletionRequestedAt != null) {
            throw new ProjectDeletionInProgressException();
        }
    }

    public boolean deletionRequested() {
        return deletionRequestedAt != null;
    }

    public UUID id() {
        return id;
    }

    public UUID workspaceId() {
        return workspaceId;
    }

    public UUID clientId() {
        return clientId;
    }

    public String title() {
        return title;
    }

    public String requirementText() {
        return requirementText;
    }

    public String currency() {
        return currency;
    }

    public LocalDate deadline() {
        return deadline;
    }

    public BigDecimal budgetMin() {
        return budgetMin;
    }

    public BigDecimal budgetMax() {
        return budgetMax;
    }

    public String status() {
        return status;
    }

    public UUID createdBy() {
        return createdBy;
    }

    public Instant createdAt() {
        return createdAt;
    }

    public Instant updatedAt() {
        return updatedAt;
    }

    public long version() {
        return version;
    }
}


