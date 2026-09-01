package com.freelanceops.backend.domain.agenttask.dto.response;

import com.freelanceops.backend.domain.agenttask.model.AgentTaskStatus;

import java.time.Instant;
import java.util.UUID;

public record AgentTaskCommandResponse(UUID commandId, UUID taskId, int revision, AgentTaskStatus status,
                                       Instant acceptedAt) {
}
