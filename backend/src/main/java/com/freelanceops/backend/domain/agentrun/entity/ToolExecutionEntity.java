package com.freelanceops.backend.domain.agentrun.entity;

import com.freelanceops.backend.domain.agentrun.model.ToolExecutionStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "tool_execution", schema = "app")
public class ToolExecutionEntity {

    @Id
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "agent_run_id", nullable = false)
    private UUID agentRunId;

    @Column(name = "tool_name", nullable = false, length = 100)
    private String toolName;

    @Column(name = "input_hash", nullable = false, length = 64)
    private String inputHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ToolExecutionStatus status;

    @Column(name = "result_summary", length = 500)
    private String resultSummary;

    @Column(name = "error_code", length = 100)
    private String errorCode;

    @Column(name = "latency_ms")
    private Long latencyMs;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    protected ToolExecutionEntity() {
    }

    public ToolExecutionEntity(UUID id, UUID workspaceId, UUID agentRunId, String toolName, String inputHash, Instant startedAt) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.agentRunId = agentRunId;
        this.toolName = toolName;
        this.inputHash = inputHash;
        this.status = ToolExecutionStatus.STARTED;
        this.startedAt = startedAt;
    }

    public void succeed(String resultSummary, Instant completedAt) {
        complete(ToolExecutionStatus.SUCCEEDED, resultSummary, null, completedAt);
    }

    public void fail(String errorCode, Instant completedAt) {
        complete(ToolExecutionStatus.FAILED, null, errorCode, completedAt);
    }

    private void complete(ToolExecutionStatus nextStatus, String resultSummary, String errorCode, Instant completedAt) {
        if (status != ToolExecutionStatus.STARTED) throw new IllegalStateException("tool execution is already completed");
        if (completedAt.isBefore(startedAt)) throw new IllegalArgumentException("completion time precedes start time");
        this.status = nextStatus;
        this.resultSummary = resultSummary;
        this.errorCode = errorCode;
        this.completedAt = completedAt;
        this.latencyMs = Duration.between(startedAt, completedAt).toMillis();
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID agentRunId() { return agentRunId; }
    public String toolName() { return toolName; }
    public String inputHash() { return inputHash; }
    public ToolExecutionStatus status() { return status; }
    public String resultSummary() { return resultSummary; }
    public String errorCode() { return errorCode; }
    public Long latencyMs() { return latencyMs; }
    public Instant startedAt() { return startedAt; }
    public Instant completedAt() { return completedAt; }
}
