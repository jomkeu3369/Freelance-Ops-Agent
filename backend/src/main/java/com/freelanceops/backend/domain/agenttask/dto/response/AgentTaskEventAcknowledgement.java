package com.freelanceops.backend.domain.agenttask.dto.response;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEventEntity;

import java.util.UUID;

public record AgentTaskEventAcknowledgement(String eventId, UUID workspaceId, UUID runId, UUID taskId,
                                            int taskRevision, UUID attemptId, int attemptNumber, String source,
                                            String sourceEventId, int sequence) {

    public static AgentTaskEventAcknowledgement from(AgentTaskEventEntity event) {
        return new AgentTaskEventAcknowledgement(event.eventId(), event.workspaceId(), event.runId(), event.taskId(),
            event.taskRevision(), event.attemptId(), event.attemptNumber(), event.source(), event.sourceEventId(),
            event.sequence());
    }
}
