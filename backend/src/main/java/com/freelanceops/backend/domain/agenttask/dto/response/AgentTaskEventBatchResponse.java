package com.freelanceops.backend.domain.agenttask.dto.response;

import java.util.List;

public record AgentTaskEventBatchResponse(List<String> acceptedEventIds) {
    public AgentTaskEventBatchResponse {
        acceptedEventIds = List.copyOf(acceptedEventIds);
    }
}
