package com.freelanceops.backend.domain.agenttask.dto.response;

import java.util.List;

public record AgentTaskEventBatchResponse(List<AgentTaskEventAcknowledgement> acknowledgements) {
    public AgentTaskEventBatchResponse {
        acknowledgements = List.copyOf(acknowledgements);
    }
}
