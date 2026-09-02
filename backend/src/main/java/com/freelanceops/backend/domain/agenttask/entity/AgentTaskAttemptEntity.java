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
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
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
    @Column(name = "checkpoint_id", length = 128) private String checkpointId;
    @Column(name = "checkpoint_artifact_reference", length = 500) private String checkpointArtifactReference;
    @Column(name = "checkpoint_restored_seconds") private Double checkpointRestoredSeconds;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "completed_steps", nullable = false, columnDefinition = "jsonb") private List<String> completedSteps = List.of();
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "side_effect_idempotency_keys", nullable = false, columnDefinition = "jsonb") private List<String> sideEffectIdempotencyKeys = List.of();
    @Column(name = "failure_classification", length = 40) private String failureClassification;
    @Column(name = "classification_confidence") private Double classificationConfidence;
    @Column(name = "classifier_version", length = 100) private String classifierVersion;
    @Column(name = "retry_decision", length = 20) private String retryDecision;
    @Column(name = "retry_reason", length = 80) private String retryReason;
    @Column(name = "retry_ready_at") private Instant retryReadyAt;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "retry_snapshot", columnDefinition = "jsonb") private Map<String, Object> retrySnapshot;
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

    public boolean projectStarted(Instant now) {
        if (status.terminal()) return false;
        if (status == AgentTaskAttemptStatus.RUNNING || status == AgentTaskAttemptStatus.CHECKPOINTED) return true;
        if (status != AgentTaskAttemptStatus.QUEUED && status != AgentTaskAttemptStatus.LEASED) {
            throw new IllegalStateException("attempt event cannot start from current status");
        }
        status = AgentTaskAttemptStatus.RUNNING;
        if (startedAt == null) startedAt = now;
        updatedAt = now;
        return true;
    }

    public boolean projectCheckpointed(Map<String, Object> data, Instant now) {
        if (status.terminal()) return false;
        if (status == AgentTaskAttemptStatus.CHECKPOINTED && Objects.equals(checkpointId, text(data, "checkpoint_id"))) return true;
        if (status != AgentTaskAttemptStatus.RUNNING) {
            throw new IllegalStateException("only running attempt can checkpoint");
        }
        checkpointId = requiredText(data, "checkpoint_id");
        checkpointArtifactReference = requiredText(data, "checkpoint_artifact_reference");
        checkpointRestoredSeconds = nonnegativeDouble(data, "checkpoint_restored_seconds");
        completedSteps = stringList(data, "completed_steps");
        sideEffectIdempotencyKeys = stringList(data, "side_effect_idempotency_keys");
        status = AgentTaskAttemptStatus.CHECKPOINTED;
        updatedAt = now;
        return true;
    }

    public void projectRetryDecision(Map<String, Object> data, Instant now) {
        if (status != AgentTaskAttemptStatus.FAILED) throw new IllegalStateException("retry decision requires failed attempt");
        failureClassification = requiredText(data, "failure_classification");
        classificationConfidence = boundedDouble(data, "classification_confidence", 0, 1);
        classifierVersion = requiredText(data, "classifier_version");
        requiredText(data, "bucket_policy_version");
        retryDecision = requiredText(data, "decision");
        if (!Set.of("ALLOW", "DENY").contains(retryDecision)) throw new IllegalArgumentException("retry decision is invalid");
        retryReason = requiredText(data, "reason");
        double workspaceBefore = nonnegativeDouble(data, "workspace_tokens_before");
        double workspaceAfter = nonnegativeDouble(data, "workspace_tokens_after");
        double globalBefore = nonnegativeDouble(data, "global_tokens_before");
        double globalAfter = nonnegativeDouble(data, "global_tokens_after");
        boolean tokenAccountingMatches = "ALLOW".equals(retryDecision)
            ? Math.abs(workspaceBefore - workspaceAfter - 1) < 0.000001
                && Math.abs(globalBefore - globalAfter - 1) < 0.000001
            : Math.abs(workspaceBefore - workspaceAfter) < 0.000001
                && Math.abs(globalBefore - globalAfter) < 0.000001;
        if (!tokenAccountingMatches) throw new IllegalArgumentException("retry token accounting is invalid");
        retryReadyAt = instant(data, "retry_ready_at");
        if ("ALLOW".equals(retryDecision) != (retryReadyAt != null)) {
            throw new IllegalArgumentException("retry ready time does not match decision");
        }
        retrySnapshot = Map.copyOf(data);
        updatedAt = now;
    }

    public boolean projectTerminal(AgentTaskAttemptStatus terminalStatus, String failureCode, Instant now) {
        if (!terminalStatus.terminal() || terminalStatus == AgentTaskAttemptStatus.SUPERSEDED) {
            throw new IllegalArgumentException("invalid projected attempt status");
        }
        if (status.terminal()) return status == terminalStatus;
        if (status != AgentTaskAttemptStatus.RUNNING && status != AgentTaskAttemptStatus.CHECKPOINTED) {
            throw new IllegalStateException("only active attempt can complete");
        }
        status = terminalStatus;
        this.failureCode = failureCode;
        completedAt = now;
        leaseOwner = null;
        leaseUntil = null;
        updatedAt = now;
        return true;
    }

    public boolean projectUpdateApplied(Instant now) {
        if (status.terminal()) return false;
        if (status == AgentTaskAttemptStatus.RUNNING) return true;
        if (status != AgentTaskAttemptStatus.CHECKPOINTED) {
            throw new IllegalStateException("only checkpointed attempt can apply update");
        }
        status = AgentTaskAttemptStatus.RUNNING;
        updatedAt = now;
        return true;
    }

    public boolean cancel(Instant now) {
        if (status == AgentTaskAttemptStatus.CANCELLED) return true;
        if (status.terminal()) return false;
        status = AgentTaskAttemptStatus.CANCELLED;
        completedAt = startedAt == null ? null : now;
        leaseOwner = null;
        leaseUntil = null;
        updatedAt = now;
        return true;
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

    private static String requiredText(Map<String, Object> data, String key) {
        return requireText(text(data, key), key);
    }

    private static String text(Map<String, Object> data, String key) {
        Object value = data.get(key);
        return value == null ? null : String.valueOf(value);
    }

    private static Double nonnegativeDouble(Map<String, Object> data, String key) {
        return boundedDouble(data, key, 0, Double.MAX_VALUE);
    }

    private static Double boundedDouble(Map<String, Object> data, String key, double minimum, double maximum) {
        Object value = data.get(key);
        if (!(value instanceof Number number) || number.doubleValue() < minimum || number.doubleValue() > maximum) {
            throw new IllegalArgumentException(key + " is invalid");
        }
        return number.doubleValue();
    }

    private static List<String> stringList(Map<String, Object> data, String key) {
        Object value = data.get(key);
        if (!(value instanceof Iterable<?> values)) throw new IllegalArgumentException(key + " is invalid");
        List<String> result = new java.util.ArrayList<>();
        for (Object item : values) result.add(requireText(String.valueOf(item), key));
        if (result.size() != Set.copyOf(result).size()) throw new IllegalArgumentException(key + " must be unique");
        return List.copyOf(result);
    }

    private static Instant instant(Map<String, Object> data, String key) {
        Object value = data.get(key);
        if (value == null) return null;
        try {
            return Instant.parse(String.valueOf(value));
        } catch (java.time.format.DateTimeParseException error) {
            throw new IllegalArgumentException(key + " is invalid", error);
        }
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID taskId() { return taskId; }
    public int taskRevision() { return taskRevision; }
    public int attemptNumber() { return attemptNumber; }
    public AgentTaskAttemptStatus status() { return status; }
    public String leaseOwner() { return leaseOwner; }
    public Instant leaseUntil() { return leaseUntil; }
    public String checkpointId() { return checkpointId; }
    public String checkpointArtifactReference() { return checkpointArtifactReference; }
    public Double checkpointRestoredSeconds() { return checkpointRestoredSeconds; }
    public List<String> completedSteps() { return List.copyOf(completedSteps); }
    public List<String> sideEffectIdempotencyKeys() { return List.copyOf(sideEffectIdempotencyKeys); }
    public String failureClassification() { return failureClassification; }
    public Double classificationConfidence() { return classificationConfidence; }
    public String retryDecision() { return retryDecision; }
    public String retryReason() { return retryReason; }
    public Instant retryReadyAt() { return retryReadyAt; }
    public Instant queuedAt() { return queuedAt; }
    public Double predictedServiceRuntimeSeconds() { return predictedServiceRuntimeSeconds; }
    public String predictionModelVersion() { return predictionModelVersion; }
    public Map<String, Object> predictionFeatureSnapshot() {
        return predictionFeatureSnapshot == null ? Map.of() : Map.copyOf(predictionFeatureSnapshot);
    }

    public boolean hasSameRegistration(UUID expectedWorkspaceId, UUID expectedTaskId, int expectedRevision,
                                       Double predictedSeconds, String predictorVersion,
                                       Map<String, Object> featureSnapshot) {
        return workspaceId.equals(expectedWorkspaceId) && taskId.equals(expectedTaskId)
            && taskRevision == expectedRevision && Objects.equals(predictedServiceRuntimeSeconds, predictedSeconds)
            && Objects.equals(predictionModelVersion, predictorVersion)
            && predictionFeatureSnapshot().equals(featureSnapshot == null ? Map.of() : featureSnapshot);
    }
}
