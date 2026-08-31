package com.freelanceops.backend.domain.agenttask.entity;

import com.freelanceops.backend.domain.agenttask.model.AgentTaskCommandType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "agent_task_command", schema = "app")
public class AgentTaskCommandEntity {

    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "run_id", nullable = false) private UUID runId;
    @Column(name = "task_id", nullable = false) private UUID taskId;
    @Column(name = "expected_task_revision", nullable = false) private int expectedTaskRevision;
    @Enumerated(EnumType.STRING) @Column(name = "command_type", nullable = false, length = 30) private AgentTaskCommandType commandType;
    @Column(name = "idempotency_key", nullable = false, length = 128) private String idempotencyKey;
    @JdbcTypeCode(SqlTypes.JSON) @Column(nullable = false, columnDefinition = "jsonb") private Map<String, Object> payload;
    @Column(name = "requested_by", nullable = false) private UUID requestedBy;
    @Column(name = "authorization_revision", nullable = false) private long authorizationRevision;
    @Column(name = "budget_revision", nullable = false) private long budgetRevision;
    @Column(name = "requested_at", nullable = false) private Instant requestedAt;

    protected AgentTaskCommandEntity() {
    }

    public AgentTaskCommandEntity(UUID id, UUID workspaceId, UUID runId, UUID taskId, int expectedTaskRevision,
                                  AgentTaskCommandType commandType, String idempotencyKey, Map<String, Object> payload,
                                  UUID requestedBy, long authorizationRevision, long budgetRevision, Instant requestedAt) {
        this.id = Objects.requireNonNull(id);
        this.workspaceId = Objects.requireNonNull(workspaceId);
        this.runId = Objects.requireNonNull(runId);
        this.taskId = Objects.requireNonNull(taskId);
        if (expectedTaskRevision < 1) throw new IllegalArgumentException("expected task revision must be positive");
        this.expectedTaskRevision = expectedTaskRevision;
        this.commandType = Objects.requireNonNull(commandType);
        if (idempotencyKey == null || idempotencyKey.isBlank() || idempotencyKey.length() > 128) {
            throw new IllegalArgumentException("idempotency key is invalid");
        }
        this.idempotencyKey = idempotencyKey;
        this.payload = Map.copyOf(Objects.requireNonNull(payload));
        this.requestedBy = Objects.requireNonNull(requestedBy);
        if (authorizationRevision < 1 || budgetRevision < 1) throw new IllegalArgumentException("policy revisions must be positive");
        this.authorizationRevision = authorizationRevision;
        this.budgetRevision = budgetRevision;
        this.requestedAt = Objects.requireNonNull(requestedAt);
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID runId() { return runId; }
    public UUID taskId() { return taskId; }
    public int expectedTaskRevision() { return expectedTaskRevision; }
    public AgentTaskCommandType commandType() { return commandType; }
    public String idempotencyKey() { return idempotencyKey; }
    public Map<String, Object> payload() { return Map.copyOf(payload); }
    public UUID requestedBy() { return requestedBy; }
    public long authorizationRevision() { return authorizationRevision; }
    public long budgetRevision() { return budgetRevision; }
}
