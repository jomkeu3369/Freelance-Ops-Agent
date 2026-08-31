package com.freelanceops.backend.domain.agenttask.dto.response;

import java.util.List;

public record AgentTaskEventBatchResponse(List<String> acknowledgedEventIds) {
    public AgentTaskEventBatchResponse {
        acknowledgedEventIds = List.copyOf(acknowledgedEventIds);
    }
}
