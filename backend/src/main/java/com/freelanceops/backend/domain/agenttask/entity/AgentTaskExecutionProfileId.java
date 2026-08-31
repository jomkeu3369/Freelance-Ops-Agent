package com.freelanceops.backend.domain.agenttask.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

import java.io.Serializable;
import java.util.UUID;

@Embeddable
public record AgentTaskExecutionProfileId(
    @Column(name = "task_id") UUID taskId,
    @Column(name = "task_revision") int taskRevision
) implements Serializable {
}
