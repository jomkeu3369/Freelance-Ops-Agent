package com.freelanceops.backend.domain.agentrun.client.dto.response;

import java.util.UUID;

public record InternalAgentTaskCommandResponse(UUID commandId, UUID taskId, int taskRevision, String status,
                                               int targetRevision) {
}
