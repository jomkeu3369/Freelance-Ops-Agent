package com.freelanceops.backend.domain.agenttask.dto.response;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskStatus;
import com.freelanceops.backend.domain.agentrun.model.DepartmentName;

import java.time.Instant;
import java.util.UUID;

public record AgentTaskResponse(
    UUID taskId,
    UUID workspaceId,
    UUID runId,
    UUID parentTaskId,
    DepartmentName department,
    String specialistProfile,
    String alias,
    String objectiveReference,
    AgentTaskStatus status,
    int revision,
    int priority,
    Instant deadlineAt,
    int currentAttemptNumber,
    Instant lastHeartbeatAt,
    String phase,
    String activity
) {
    public static AgentTaskResponse from(AgentTaskEntity task) {
        return new AgentTaskResponse(task.id(), task.workspaceId(), task.runId(), task.parentTaskId(),
            task.department(), task.specialistProfile(), task.alias(), task.objectiveReference(), task.status(),
            task.revision(), task.priority(), task.deadlineAt(), task.currentAttemptNumber(),
            task.lastHeartbeatAt(), task.phase(), task.activity());
    }
}
