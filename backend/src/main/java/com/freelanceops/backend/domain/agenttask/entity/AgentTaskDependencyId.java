package com.freelanceops.backend.domain.agenttask.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

@Embeddable
public class AgentTaskDependencyId implements Serializable {

    @Column(name = "task_id") private UUID taskId;
    @Column(name = "depends_on_task_id") private UUID dependsOnTaskId;

    protected AgentTaskDependencyId() {
    }

    public AgentTaskDependencyId(UUID taskId, UUID dependsOnTaskId) {
        this.taskId = Objects.requireNonNull(taskId);
        this.dependsOnTaskId = Objects.requireNonNull(dependsOnTaskId);
    }

    public UUID taskId() { return taskId; }
    public UUID dependsOnTaskId() { return dependsOnTaskId; }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof AgentTaskDependencyId that)) return false;
        return taskId.equals(that.taskId) && dependsOnTaskId.equals(that.dependsOnTaskId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(taskId, dependsOnTaskId);
    }
}
