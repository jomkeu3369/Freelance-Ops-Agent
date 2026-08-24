package com.freelanceops.backend.domain.agentrun.entity;

import com.freelanceops.backend.domain.agentrun.model.AgentRunCommandStatus;
import com.freelanceops.backend.domain.agentrun.model.AgentRunCommandType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "agent_run_command", schema = "app")
public class AgentRunCommandEntity {

    @Id
    private UUID id;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Enumerated(EnumType.STRING)
    @Column(name = "command_type", nullable = false, length = 20)
    private AgentRunCommandType commandType;

    @Column(nullable = false, columnDefinition = "text")
    private String payload;

    @Column(name = "requested_by", nullable = false)
    private UUID requestedBy;

    @Column(name = "effective_permissions", nullable = false, columnDefinition = "text")
    private String effectivePermissions;

    @Column(length = 55)
    private String traceparent;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private AgentRunCommandStatus status;

    @Column(nullable = false)
    private int attempts;

    @Column(name = "available_at", nullable = false)
    private Instant availableAt;

    @Column(name = "lease_until")
    private Instant leaseUntil;

    @Column(name = "last_error", length = 500)
    private String lastError;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    private long version;

    protected AgentRunCommandEntity() {
    }

    public AgentRunCommandEntity(UUID id, UUID runId, AgentRunCommandType commandType, String payload,
                                 UUID requestedBy, String effectivePermissions, String traceparent, Instant now) {
        this.id = id;
        this.runId = runId;
        this.commandType = commandType;
        this.payload = payload;
        this.requestedBy = requestedBy;
        this.effectivePermissions = effectivePermissions;
        this.traceparent = traceparent;
        this.status = AgentRunCommandStatus.PENDING;
        this.attempts = 0;
        this.availableAt = now;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void claim(Instant now, Duration lease) {
        if (!dispatchableAt(now)) throw new IllegalStateException("agent command is not dispatchable");
        status = AgentRunCommandStatus.PROCESSING;
        attempts++;
        leaseUntil = now.plus(lease);
        updatedAt = now;
    }

    public boolean dispatchableAt(Instant now) {
        return (status == AgentRunCommandStatus.PENDING && !availableAt.isAfter(now))
            || (status == AgentRunCommandStatus.PROCESSING && leaseUntil != null && !leaseUntil.isAfter(now));
    }

    public boolean complete(Instant now, int claimedAttempt) {
        if (!ownsClaim(claimedAttempt)) return false;
        status = AgentRunCommandStatus.COMPLETED;
        leaseUntil = null;
        lastError = null;
        updatedAt = now;
        return true;
    }

    public boolean retry(Instant now, Duration delay, String error, int claimedAttempt) {
        if (!ownsClaim(claimedAttempt)) return false;
        status = AgentRunCommandStatus.PENDING;
        availableAt = now.plus(delay);
        leaseUntil = null;
        lastError = truncate(error);
        updatedAt = now;
        return true;
    }

    public boolean fail(Instant now, String error, int claimedAttempt) {
        if (!ownsClaim(claimedAttempt)) return false;
        status = AgentRunCommandStatus.FAILED;
        leaseUntil = null;
        lastError = truncate(error);
        updatedAt = now;
        return true;
    }

    private boolean ownsClaim(int claimedAttempt) {
        return status == AgentRunCommandStatus.PROCESSING && attempts == claimedAttempt;
    }

    private static String truncate(String value) {
        if (value == null) return null;
        return value.length() <= 500 ? value : value.substring(0, 500);
    }

    public UUID id() { return id; }
    public UUID runId() { return runId; }
    public AgentRunCommandType commandType() { return commandType; }
    public String payload() { return payload; }
    public UUID requestedBy() { return requestedBy; }
    public String effectivePermissions() { return effectivePermissions; }
    public String traceparent() { return traceparent; }
    public AgentRunCommandStatus status() { return status; }
    public int attempts() { return attempts; }
}
