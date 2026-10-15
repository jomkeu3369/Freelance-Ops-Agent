package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 워크스페이스와 프로젝트 범위에서 실제 Agent 실행에 연결해 저장한 사용자 메시지다. */
public record AgentChatTurn(
        UUID runId,
        String requirementText,
        AgentRunStatus status,
        Instant createdAt,
        List<AttachmentSummary> attachments,
        OriginalInputStatus originalInputStatus,
        OriginalInputIssue originalInputIssue) {
    /** UNAVAILABLE은 원문을 읽을 수 없는 상태다. 별도로 저장된 실행 결과는 계속 조회할 수 있다. */
    public enum OriginalInputStatus {
        AVAILABLE,
        PARTIAL,
        UNAVAILABLE
    }

    public enum OriginalInputIssue {
        MISSING_START,
        MALFORMED_PAYLOAD,
        MISSING_INPUT,
        INVALID_REQUIREMENT_TEXT,
        INVALID_ATTACHMENTS
    }

    public record AttachmentSummary(String name, String status, String notice) {}

    public AgentChatTurn(
            UUID runId,
            String requirementText,
            AgentRunStatus status,
            Instant createdAt,
            List<AttachmentSummary> attachments) {
        this(
                runId,
                requirementText,
                status,
                createdAt,
                attachments,
                OriginalInputStatus.AVAILABLE,
                null);
    }

    public AgentChatTurn(
            UUID runId, String requirementText, AgentRunStatus status, Instant createdAt) {
        this(runId, requirementText, status, createdAt, List.of());
    }
}
