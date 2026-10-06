package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** A durable user message linked to a real Agent run, scoped by the calling workspace and project. */
public record AgentChatTurn(UUID runId, String requirementText, AgentRunStatus status, Instant createdAt,
                            List<AttachmentSummary> attachments, OriginalInputStatus originalInputStatus,
                            OriginalInputIssue originalInputIssue) {
    /** UNAVAILABLE means the original text cannot be read; independent run results remain accessible. */
    public enum OriginalInputStatus { AVAILABLE, PARTIAL, UNAVAILABLE }
    public enum OriginalInputIssue { MISSING_START, MALFORMED_PAYLOAD, MISSING_INPUT, INVALID_REQUIREMENT_TEXT, INVALID_ATTACHMENTS }
    public record AttachmentSummary(String name, String status, String notice) { }

    public AgentChatTurn(UUID runId, String requirementText, AgentRunStatus status, Instant createdAt, List<AttachmentSummary> attachments) {
        this(runId, requirementText, status, createdAt, attachments, OriginalInputStatus.AVAILABLE, null);
    }

    public AgentChatTurn(UUID runId, String requirementText, AgentRunStatus status, Instant createdAt) {
        this(runId, requirementText, status, createdAt, List.of());
    }
}
