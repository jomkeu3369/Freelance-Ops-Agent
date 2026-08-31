package com.freelanceops.backend.domain.agenttask.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "agent_task_event", schema = "app")
public class AgentTaskEventEntity {

    @Id @Column(name = "event_id", length = 128) private String eventId;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "run_id", nullable = false) private UUID runId;
    @Column(name = "task_id", nullable = false) private UUID taskId;
    @Column(name = "task_revision", nullable = false) private int taskRevision;
    @Column(name = "attempt_id", nullable = false) private UUID attemptId;
    @Column(name = "attempt_number", nullable = false) private int attemptNumber;
    @Column(name = "schema_version", nullable = false, length = 64) private String schemaVersion;
    @Column(nullable = false, length = 64) private String source;
    @Column(name = "source_event_id", nullable = false, length = 128) private String sourceEventId;
    @Column(nullable = false) private int sequence;
    @Column(name = "event_type", nullable = false, length = 64) private String eventType;
    @Column(length = 100) private String phase;
    @Column(length = 200) private String milestone;
    @JdbcTypeCode(SqlTypes.JSON) @Column(nullable = false, columnDefinition = "jsonb") private Map<String, Object> data;
    @Column(name = "occurred_at", nullable = false) private Instant occurredAt;
    @Column(name = "received_at", nullable = false) private Instant receivedAt;

    protected AgentTaskEventEntity() {
    }

    public AgentTaskEventEntity(String eventId, UUID workspaceId, UUID runId, UUID taskId, int taskRevision,
                                UUID attemptId, int attemptNumber, String schemaVersion, String source,
                                String sourceEventId, int sequence, String eventType, String phase, String milestone,
                                Map<String, Object> data, Instant occurredAt, Instant receivedAt) {
        this.eventId = eventId;
        this.workspaceId = workspaceId;
        this.runId = runId;
        this.taskId = taskId;
        this.taskRevision = taskRevision;
        this.attemptId = attemptId;
        this.attemptNumber = attemptNumber;
        this.schemaVersion = schemaVersion;
        this.source = source;
        this.sourceEventId = sourceEventId;
        this.sequence = sequence;
        this.eventType = eventType;
        this.phase = phase;
        this.milestone = milestone;
        this.data = Map.copyOf(data);
        this.occurredAt = occurredAt;
        this.receivedAt = receivedAt;
    }

    public String eventId() { return eventId; }
    public UUID workspaceId() { return workspaceId; }
    public UUID runId() { return runId; }
    public UUID taskId() { return taskId; }
    public int taskRevision() { return taskRevision; }
    public UUID attemptId() { return attemptId; }
    public int attemptNumber() { return attemptNumber; }
    public String source() { return source; }
    public String sourceEventId() { return sourceEventId; }
    public int sequence() { return sequence; }
    public String eventType() { return eventType; }
    public String schemaVersion() { return schemaVersion; }
    public String phase() { return phase; }
    public String milestone() { return milestone; }
    public Map<String, Object> data() { return Map.copyOf(data); }
    public Instant occurredAt() { return occurredAt; }
}
