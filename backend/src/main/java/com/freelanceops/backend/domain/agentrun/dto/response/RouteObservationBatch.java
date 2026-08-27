package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;

import java.util.List;
import java.util.UUID;

public record RouteObservationBatch(
    UUID runId,
    AgentRunStatus status,
    List<AgentRunEvent> events,
    long nextEventId,
    boolean hasMore,
    boolean terminal
) { }
