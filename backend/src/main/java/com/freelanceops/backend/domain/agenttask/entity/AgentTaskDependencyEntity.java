package com.freelanceops.backend.domain.agenttask.entity;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "agent_task_dependency", schema = "app")
public class AgentTaskDependencyEntity {

    @EmbeddedId private AgentTaskDependencyId id;
    @Column(name = "dependency_type", nullable = false, length = 20) private String dependencyType;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected AgentTaskDependencyEntity() {
    }

    public AgentTaskDependencyEntity(UUID taskId, UUID dependsOnTaskId, String dependencyType, Instant now) {
        if (taskId.equals(dependsOnTaskId)) throw new IllegalArgumentException("task cannot depend on itself");
        this.id = new AgentTaskDependencyId(taskId, dependsOnTaskId);
        if (!"COMPLETION".equals(dependencyType) && !"SUCCESS".equals(dependencyType)) {
            throw new IllegalArgumentException("unsupported dependency type");
        }
        this.dependencyType = dependencyType;
        this.createdAt = Objects.requireNonNull(now);
    }

    public AgentTaskDependencyId id() { return id; }
}
