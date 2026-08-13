package com.freelanceops.backend.domain.agentrun.entity;

import com.freelanceops.backend.domain.agentrun.model.InterruptionKind;
import com.freelanceops.backend.domain.agentrun.model.InterruptionStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "agent_interruption", schema = "app")
public class AgentInterruptionEntity {

    @Id
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "agent_run_id", nullable = false)
    private UUID agentRunId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private InterruptionKind kind;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private InterruptionStatus status;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private List<String> questions;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<Map<String, Object>> answers;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "responded_at")
    private Instant respondedAt;

    @Version
    private long version;

    protected AgentInterruptionEntity() {
    }

    public AgentInterruptionEntity(UUID id, UUID workspaceId, UUID agentRunId, InterruptionKind kind, List<String> questions, Instant createdAt) {
        if (questions == null || questions.isEmpty()) throw new IllegalArgumentException("interruption requires questions");
        this.id = id;
        this.workspaceId = workspaceId;
        this.agentRunId = agentRunId;
        this.kind = kind;
        this.status = InterruptionStatus.PENDING;
        this.questions = List.copyOf(questions);
        this.createdAt = createdAt;
    }

    public void respond(List<Map<String, Object>> answers, Instant respondedAt) {
        if (status != InterruptionStatus.PENDING) throw new IllegalStateException("interruption is not pending");
        if (answers == null || answers.isEmpty()) throw new IllegalArgumentException("interruption response requires answers");
        this.answers = List.copyOf(answers);
        this.status = InterruptionStatus.RESPONDED;
        this.respondedAt = respondedAt;
    }

    public void cancel() {
        if (status == InterruptionStatus.PENDING) status = InterruptionStatus.CANCELLED;
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID agentRunId() { return agentRunId; }
    public InterruptionKind kind() { return kind; }
    public InterruptionStatus status() { return status; }
    public List<String> questions() { return List.copyOf(questions); }
    public List<Map<String, Object>> answers() { return answers == null ? null : List.copyOf(answers); }
    public Instant respondedAt() { return respondedAt; }
}
