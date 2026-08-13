package com.freelanceops.backend.project.infrastructure.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "project", schema = "app")
public class ProjectEntity {

    @Id
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

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

    @Version
    private long version;

    protected ProjectEntity() {
    }

    public ProjectEntity(UUID id, UUID workspaceId, String title, String requirementText, String currency, LocalDate deadline, BigDecimal budgetMin, BigDecimal budgetMax) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.title = title;
        this.requirementText = requirementText;
        this.currency = currency;
        this.deadline = deadline;
        this.budgetMin = budgetMin;
        this.budgetMax = budgetMax;
    }

    public UUID id() {
        return id;
    }

    public UUID workspaceId() {
        return workspaceId;
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
}
