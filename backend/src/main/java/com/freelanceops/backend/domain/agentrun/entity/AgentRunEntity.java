package com.freelanceops.backend.domain.agentrun.entity;

import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "agent_run", schema = "app")
public class AgentRunEntity {

    @Id
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "thread_id", nullable = false)
    private UUID threadId;

    @Column(name = "initiated_by", nullable = false)
    private UUID initiatedBy;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Provider provider;

    @Column(nullable = false, length = 100)
    private String model;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private AgentRunStatus status;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    private long version;

    protected AgentRunEntity() {
    }

    public AgentRunEntity(UUID id, UUID workspaceId, UUID projectId, UUID threadId, UUID initiatedBy, Provider provider, String model, AgentRunStatus status, Instant now) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.projectId = projectId;
        this.threadId = threadId;
        this.initiatedBy = initiatedBy;
        this.provider = provider;
        this.model = model;
        this.status = status;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void updateStatus(AgentRunStatus status, Instant now) {
        this.status = status;
        this.updatedAt = now;
    }

    public UUID id() {
        return id;
    }

    public UUID workspaceId() {
        return workspaceId;
    }

    public UUID projectId() {
        return projectId;
    }

    public UUID threadId() {
        return threadId;
    }

    public UUID initiatedBy() {
        return initiatedBy;
    }

    public Provider provider() {
        return provider;
    }

    public String model() {
        return model;
    }

    public AgentRunStatus status() {
        return status;
    }
}


