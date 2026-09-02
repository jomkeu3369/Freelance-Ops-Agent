package com.freelanceops.backend.domain.agenttask.dto.response;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskAttemptEntity;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskAttemptStatus;

import java.time.Instant;
import java.util.UUID;

public record AgentTaskAttemptRegistrationResponse(
    UUID attemptId,
    UUID taskId,
    int taskRevision,
    int attemptNumber,
    AgentTaskAttemptStatus status,
    Instant queuedAt
) {
    public static AgentTaskAttemptRegistrationResponse from(AgentTaskAttemptEntity attempt) {
        return new AgentTaskAttemptRegistrationResponse(attempt.id(), attempt.taskId(), attempt.taskRevision(),
            attempt.attemptNumber(), attempt.status(), attempt.queuedAt());
    }
}
