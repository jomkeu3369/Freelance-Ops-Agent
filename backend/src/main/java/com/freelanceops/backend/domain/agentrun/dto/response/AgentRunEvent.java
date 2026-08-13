package com.freelanceops.backend.domain.agentrun.dto.response;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record AgentRunEvent(long eventId, UUID runId, String type, Instant occurredAt, Map<String, Object> data) {
}
