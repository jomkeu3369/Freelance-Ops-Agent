package com.freelanceops.backend.domain.agenttask.entity;

import com.freelanceops.backend.domain.agenttask.model.AgentTaskAttemptStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "agent_task_attempt", schema = "app")
public class AgentTaskAttemptEntity {

    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "task_id", nullable = false) private UUID taskId;
    @Column(name = "task_revision", nullable = false) private int taskRevision;
    @Column(name = "attempt_number", nullable = false) private int attemptNumber;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 32) private AgentTaskAttemptStatus status;
    @Column(name = "queued_at", nullable = false) private Instant queuedAt;
    @Column(name = "lease_owner", length = 100) private String leaseOwner;
    @Column(name = "lease_until") private Instant leaseUntil;
    @Column(name = "started_at") private Instant startedAt;
    @Column(name = "completed_at") private Instant completedAt;
    @Column(name = "predicted_service_runtime_seconds") private Double predictedServiceRuntimeSeconds;
    @Column(name = "prediction_model_version", length = 100) private String predictionModelVersion;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "prediction_feature_snapshot", columnDefinition = "jsonb") private Map<String, Object> predictionFeatureSnapshot;
    @Column(name = "cache_outcome", length = 30) private String cacheOutcome;
    @Column(name = "failure_code", length = 100) private String failureCode;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private long version;

    protected AgentTaskAttemptEntity() {
    }

    public AgentTaskAttemptEntity(UUID id, UUID workspaceId, UUID taskId, int taskRevision, int attemptNumber,
                                  Double predictedSeconds, String predictionModelVersion,
                                  Map<String, Object> predictionFeatureSnapshot, Instant now) {
        this.id = Objects.requireNonNull(id);
        this.workspaceId = Objects.requireNonNull(workspaceId);
        this.taskId = Objects.requireNonNull(taskId);
        if (taskRevision < 1 || attemptNumber < 1) throw new IllegalArgumentException("revision and attempt number must be positive");
        if ((predictedSeconds == null) != (predictionModelVersion == null)) throw new IllegalArgumentException("prediction and model version must be supplied together");
        if (predictedSeconds != null && predictedSeconds < 0) throw new IllegalArgumentException("prediction must not be negative");
        this.taskRevision = taskRevision;
        this.attemptNumber = attemptNumber;
        this.predictedServiceRuntimeSeconds = predictedSeconds;
        this.predictionModelVersion = predictionModelVersion;
        this.predictionFeatureSnapshot = predictionFeatureSnapshot;
        this.status = AgentTaskAttemptStatus.QUEUED;
        this.queuedAt = Objects.requireNonNull(now);
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void lease(String owner, Duration duration, Instant now) {
        if (status != AgentTaskAttemptStatus.QUEUED && !(status == AgentTaskAttemptStatus.LEASED && !leaseUntil.isAfter(now))) {
            throw new IllegalStateException("attempt is not leaseable");
        }
        leaseOwner = requireText(owner, "owner");
        if (duration.isZero() || duration.isNegative()) throw new IllegalArgumentException("lease duration must be positive");
        leaseUntil = now.plus(duration);
        status = AgentTaskAttemptStatus.LEASED;
        updatedAt = now;
    }

    public void start(String owner, Instant now) {
        if (status != AgentTaskAttemptStatus.LEASED || !Objects.equals(leaseOwner, owner) || leaseUntil.isBefore(now)) {
            throw new IllegalStateException("valid attempt lease is required");
        }
        status = AgentTaskAttemptStatus.RUNNING;
        startedAt = now;
        updatedAt = now;
    }

    public void complete(AgentTaskAttemptStatus terminalStatus, String failureCode, Instant now) {
        if (status != AgentTaskAttemptStatus.RUNNING && status != AgentTaskAttemptStatus.CHECKPOINTED) {
            throw new IllegalStateException("only active attempt can complete");
        }
        if (!terminalStatus.terminal() || terminalStatus == AgentTaskAttemptStatus.SUPERSEDED) {
            throw new IllegalArgumentException("invalid attempt completion status");
        }
        status = terminalStatus;
        this.failureCode = failureCode;
        completedAt = now;
        leaseOwner = null;
        leaseUntil = null;
        updatedAt = now;
    }

    public void supersede(Instant now) {
        if (status.terminal()) return;
        status = AgentTaskAttemptStatus.SUPERSEDED;
        completedAt = startedAt == null ? null : now;
        leaseOwner = null;
        leaseUntil = null;
        updatedAt = now;
    }

    private static String requireText(String value, String name) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " must not be blank");
        return value;
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID taskId() { return taskId; }
    public int taskRevision() { return taskRevision; }
    public int attemptNumber() { return attemptNumber; }
    public AgentTaskAttemptStatus status() { return status; }
    public String leaseOwner() { return leaseOwner; }
    public Instant leaseUntil() { return leaseUntil; }
}
