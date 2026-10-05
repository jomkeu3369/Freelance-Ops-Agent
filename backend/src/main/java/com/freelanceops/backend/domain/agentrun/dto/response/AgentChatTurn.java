package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import java.time.Instant;
import java.util.UUID;

/** A durable user message linked to a real Agent run, scoped by the calling workspace and project. */
public record AgentChatTurn(UUID runId, String requirementText, AgentRunStatus status, Instant createdAt, java.util.List<AttachmentSummary> attachments) {
    public record AttachmentSummary(String name, String status, String notice) { }
    public AgentChatTurn(UUID runId, String requirementText, AgentRunStatus status, Instant createdAt) {
        this(runId, requirementText, status, createdAt, java.util.List.of());
    }
}
