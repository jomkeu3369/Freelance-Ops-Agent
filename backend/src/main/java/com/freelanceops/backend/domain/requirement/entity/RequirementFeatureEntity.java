package com.freelanceops.backend.domain.requirement.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "requirement_feature", schema = "app")
public class RequirementFeatureEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "requirement_version_id", nullable = false) private UUID requirementVersionId;
    @Column(nullable = false, length = 200) private String title;
    @Column(nullable = false, length = 5000) private String description;
    @Column(nullable = false, length = 20) private String priority;
    @Column(name = "acceptance_criteria", length = 5000) private String acceptanceCriteria;
    @Column(name = "sort_order", nullable = false) private int sortOrder;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected RequirementFeatureEntity() {
    }

    public RequirementFeatureEntity(UUID id, UUID workspaceId, UUID requirementVersionId, String title, String description, String priority, String acceptanceCriteria, int sortOrder, Instant createdAt) {
        this.id = id; this.workspaceId = workspaceId; this.requirementVersionId = requirementVersionId;
        this.title = title; this.description = description; this.priority = priority;
        this.acceptanceCriteria = acceptanceCriteria; this.sortOrder = sortOrder; this.createdAt = createdAt;
    }

    public String title() { return title; }
    public String description() { return description; }
    public String priority() { return priority; }
    public String acceptanceCriteria() { return acceptanceCriteria; }
}
