package com.freelanceops.backend.domain.requirement.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "requirement_assumption", schema = "app")
public class RequirementAssumptionEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "requirement_version_id", nullable = false) private UUID requirementVersionId;
    @Column(nullable = false, length = 3000) private String content;
    @Column(name = "sort_order", nullable = false) private int sortOrder;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected RequirementAssumptionEntity() {
    }

    public RequirementAssumptionEntity(UUID id, UUID workspaceId, UUID requirementVersionId, String content, int sortOrder, Instant createdAt) {
        this.id = id; this.workspaceId = workspaceId; this.requirementVersionId = requirementVersionId;
        this.content = content; this.sortOrder = sortOrder; this.createdAt = createdAt;
    }

    public String content() { return content; }
}
