package com.freelanceops.backend.domain.agenttask.entity;

import com.freelanceops.backend.domain.agenttask.model.AgentTaskStatus;
import com.freelanceops.backend.domain.agentrun.model.DepartmentName;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "agent_task", schema = "app")
public class AgentTaskEntity {

    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "run_id", nullable = false) private UUID runId;
    @Column(name = "parent_task_id") private UUID parentTaskId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 32) private DepartmentName department;
    @Column(name = "specialist_profile", nullable = false, length = 100) private String specialistProfile;
    @Column(nullable = false, length = 100) private String alias;
    @Column(name = "objective_reference", nullable = false, length = 200) private String objectiveReference;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 32) private AgentTaskStatus status;
    @Column(nullable = false) private int revision;
    @Column(nullable = false) private int priority;
    @Column(name = "deadline_at") private Instant deadlineAt;
    @Column(name = "current_attempt_number", nullable = false) private int currentAttemptNumber;
    @Column(name = "last_heartbeat_at") private Instant lastHeartbeatAt;
    @Column(length = 100) private String phase;
    @Column(length = 300) private String activity;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private long version;

    protected AgentTaskEntity() {
    }

    public AgentTaskEntity(UUID id, UUID workspaceId, UUID runId, UUID parentTaskId, DepartmentName department,
                           String specialistProfile, String alias, String objectiveReference, int priority,
                           Instant deadlineAt, Instant now) {
        this.id = Objects.requireNonNull(id);
        this.workspaceId = Objects.requireNonNull(workspaceId);
        this.runId = Objects.requireNonNull(runId);
        if (id.equals(parentTaskId)) throw new IllegalArgumentException("task cannot be its own parent");
        this.parentTaskId = parentTaskId;
        this.department = Objects.requireNonNull(department);
        this.specialistProfile = requireText(specialistProfile, "specialistProfile");
        this.alias = requireText(alias, "alias");
        this.objectiveReference = requireText(objectiveReference, "objectiveReference");
        if (priority < 1 || priority > 5) throw new IllegalArgumentException("priority must be between 1 and 5");
        this.priority = priority;
        this.deadlineAt = deadlineAt;
        this.status = AgentTaskStatus.QUEUED;
        this.revision = 1;
        this.currentAttemptNumber = 0;
        this.createdAt = Objects.requireNonNull(now);
        this.updatedAt = now;
    }

    public int dispatch(int expectedRevision, Instant now) {
        requireRevision(expectedRevision);
        if (status != AgentTaskStatus.QUEUED) throw new IllegalStateException("only queued task can be dispatched");
        currentAttemptNumber++;
        status = AgentTaskStatus.DISPATCHED;
        updatedAt = now;
        return currentAttemptNumber;
    }

    public void start(int expectedRevision, int attemptNumber, Instant now) {
        requireCurrentAttempt(expectedRevision, attemptNumber);
        if (status != AgentTaskStatus.DISPATCHED) throw new IllegalStateException("only dispatched task can start");
        status = AgentTaskStatus.RUNNING;
        updatedAt = now;
    }

    public void heartbeat(int expectedRevision, int attemptNumber, String phase, String activity, Instant now) {
        requireCurrentAttempt(expectedRevision, attemptNumber);
        if (status.terminal() || status == AgentTaskStatus.CANCELLING) throw new IllegalStateException("terminal task cannot heartbeat");
        this.phase = requireText(phase, "phase");
        this.activity = requireText(activity, "activity");
        lastHeartbeatAt = now;
        updatedAt = now;
    }

    public boolean projectStarted(int eventRevision, int attemptNumber, Instant now) {
        if (!isCurrent(eventRevision, attemptNumber) || status.terminal() || status == AgentTaskStatus.CANCELLING) {
            return false;
        }
        if (status == AgentTaskStatus.DISPATCHED) status = AgentTaskStatus.RUNNING;
        if (status != AgentTaskStatus.RUNNING && status != AgentTaskStatus.WAITING_FOR_TOOL
            && status != AgentTaskStatus.WAITING_FOR_USER && status != AgentTaskStatus.UPDATE_PENDING) {
            throw new IllegalStateException("task event cannot start from current status");
        }
        updatedAt = now;
        return true;
    }

    public boolean projectProgress(int eventRevision, int attemptNumber, String phase, String activity, Instant now) {
        if (!isCurrent(eventRevision, attemptNumber) || status.terminal() || status == AgentTaskStatus.CANCELLING) {
            return false;
        }
        this.phase = requireText(phase, "phase");
        this.activity = requireText(activity, "activity");
        lastHeartbeatAt = now;
        updatedAt = now;
        return true;
    }

    public boolean complete(int expectedRevision, int attemptNumber, AgentTaskStatus terminalStatus, Instant now) {
        if (revision != expectedRevision || currentAttemptNumber != attemptNumber) return false;
        if (!terminalStatus.terminal() || terminalStatus == AgentTaskStatus.CANCELLED) {
            throw new IllegalArgumentException("attempt result must use a non-cancel terminal status");
        }
        if (status.terminal()) return status == terminalStatus;
        status = terminalStatus;
        updatedAt = now;
        return true;
    }

    public int redirect(int expectedRevision, Instant now) {
        return redirect(expectedRevision, objectiveReference, now);
    }

    public int redirect(int expectedRevision, String objectiveReference, Instant now) {
        requireRevision(expectedRevision);
        if (status.terminal()) throw new IllegalStateException("terminal task cannot be redirected");
        revision++;
        this.objectiveReference = requireText(objectiveReference, "objectiveReference");
        currentAttemptNumber = 0;
        status = AgentTaskStatus.QUEUED;
        phase = null;
        activity = null;
        lastHeartbeatAt = null;
        updatedAt = now;
        return revision;
    }

    public void requestSoftUpdate(int expectedRevision, Instant now) {
        requireRevision(expectedRevision);
        if (status.terminal() || status == AgentTaskStatus.CANCELLING) {
            throw new IllegalStateException("terminal or cancelling task cannot be updated");
        }
        status = AgentTaskStatus.UPDATE_PENDING;
        updatedAt = now;
    }

    public void applySoftUpdate(int expectedRevision, int attemptNumber, Instant now) {
        requireCurrentAttempt(expectedRevision, attemptNumber);
        if (status != AgentTaskStatus.UPDATE_PENDING) throw new IllegalStateException("task has no pending update");
        status = AgentTaskStatus.RUNNING;
        updatedAt = now;
    }

    public void requestCancellation(int expectedRevision, Instant now) {
        requireRevision(expectedRevision);
        if (status.terminal()) throw new IllegalStateException("terminal task cannot be cancelled");
        status = AgentTaskStatus.CANCELLING;
        updatedAt = now;
    }

    public boolean cancel(int expectedRevision, int attemptNumber, Instant now) {
        if (!isCurrent(expectedRevision, attemptNumber)) return false;
        if (status == AgentTaskStatus.CANCELLED) return true;
        if (status != AgentTaskStatus.CANCELLING) throw new IllegalStateException("task is not cancelling");
        status = AgentTaskStatus.CANCELLED;
        updatedAt = now;
        return true;
    }

    public void projectRetryDecision(int expectedRevision, int attemptNumber, boolean allowed, String reason, Instant now) {
        requireCurrentAttempt(expectedRevision, attemptNumber);
        if (status.terminal() || status == AgentTaskStatus.CANCELLING) return;
        status = allowed ? AgentTaskStatus.RETRY_WAIT : AgentTaskStatus.FAILED;
        phase = "RELIABILITY";
        activity = requireText(reason, "retryReason");
        lastHeartbeatAt = now;
        updatedAt = now;
    }

    private void requireRevision(int expectedRevision) {
        if (revision != expectedRevision) throw new IllegalStateException("task revision conflict");
    }

    private void requireCurrentAttempt(int expectedRevision, int attemptNumber) {
        requireRevision(expectedRevision);
        if (currentAttemptNumber != attemptNumber) throw new IllegalStateException("task attempt is not current");
    }

    private boolean isCurrent(int eventRevision, int attemptNumber) {
        return revision == eventRevision && currentAttemptNumber == attemptNumber;
    }

    private static String requireText(String value, String name) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " must not be blank");
        return value;
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID runId() { return runId; }
    public UUID parentTaskId() { return parentTaskId; }
    public DepartmentName department() { return department; }
    public String specialistProfile() { return specialistProfile; }
    public String alias() { return alias; }
    public String objectiveReference() { return objectiveReference; }
    public AgentTaskStatus status() { return status; }
    public int revision() { return revision; }
    public int priority() { return priority; }
    public Instant deadlineAt() { return deadlineAt; }
    public int currentAttemptNumber() { return currentAttemptNumber; }
    public Instant lastHeartbeatAt() { return lastHeartbeatAt; }
    public String phase() { return phase; }
    public String activity() { return activity; }

    public boolean hasSameRegistration(AgentTaskEntity other) {
        return id.equals(other.id) && workspaceId.equals(other.workspaceId) && runId.equals(other.runId)
            && Objects.equals(parentTaskId, other.parentTaskId) && department == other.department
            && specialistProfile.equals(other.specialistProfile) && alias.equals(other.alias)
            && objectiveReference.equals(other.objectiveReference) && priority == other.priority
            && Objects.equals(deadlineAt, other.deadlineAt);
    }
}
