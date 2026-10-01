package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import java.time.Instant;
import java.util.UUID;

/** A durable user message linked to a real Agent run, scoped by the calling workspace and project. */
public record AgentChatTurn(UUID runId, String requirementText, AgentRunStatus status, Instant createdAt) {
}
