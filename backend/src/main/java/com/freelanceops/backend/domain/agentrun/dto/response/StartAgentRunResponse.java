package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;

import java.time.Instant;
import java.util.UUID;

public record StartAgentRunResponse(UUID runId, AgentRunStatus status, Instant acceptedAt) {
}
