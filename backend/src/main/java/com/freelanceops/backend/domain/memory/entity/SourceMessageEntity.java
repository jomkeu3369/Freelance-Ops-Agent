package com.freelanceops.backend.domain.memory.entity;

import jakarta.persistence.*;
import org.hibernate.annotations.Immutable;
import java.time.Instant;
import java.util.UUID;

@Entity
@Immutable
@Table(name = "source_message", schema = "app")
public class SourceMessageEntity {
    @Id private UUID id;
    @Column(name = "event_order", insertable = false, updatable = false) private long eventOrder;
    @Column(name = "workspace_id") private UUID workspaceId;
    @Column(name = "project_id") private UUID projectId;
    @Column(name = "run_id") private UUID runId;
    @Column(name = "event_key") private String eventKey;
    private String kind;
    @Column(columnDefinition = "text") private String content;
    @Column(columnDefinition = "text") private String prompt;
    @Column(name = "created_by") private UUID createdBy;
    @Column(name = "created_at") private Instant createdAt;

    protected SourceMessageEntity() {}
    public SourceMessageEntity(UUID workspaceId, UUID projectId, String eventKey, String kind, String content, UUID createdBy) {
        this.id = UUID.randomUUID(); this.workspaceId = workspaceId; this.projectId = projectId;
        this.eventKey = eventKey; this.kind = kind; this.content = content; this.createdBy = createdBy; this.createdAt = Instant.now();
    }
    public UUID id() { return id; }
    public long eventOrder() { return eventOrder; }
    public UUID workspaceId() { return workspaceId; }
    public UUID projectId() { return projectId; }
    public UUID runId() { return runId; }
    public String kind() { return kind; }
    public String content() { return content; }
    public String prompt() { return prompt; }
    public Instant createdAt() { return createdAt; }
}
