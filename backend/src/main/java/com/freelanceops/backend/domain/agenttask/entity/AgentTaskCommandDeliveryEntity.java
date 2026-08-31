package com.freelanceops.backend.domain.agenttask.entity;

import com.freelanceops.backend.domain.agenttask.model.AgentTaskCommandDeliveryStatus;
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
@Table(name = "agent_task_command_delivery", schema = "app")
public class AgentTaskCommandDeliveryEntity {

    @Id @Column(name = "command_id") private UUID commandId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private AgentTaskCommandDeliveryStatus status;
    @Column(nullable = false) private int attempts;
    @Column(name = "available_at", nullable = false) private Instant availableAt;
    @Column(name = "lease_until") private Instant leaseUntil;
    @Column(name = "last_error", length = 500) private String lastError;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private long version;

    protected AgentTaskCommandDeliveryEntity() {
    }

    public AgentTaskCommandDeliveryEntity(UUID commandId, Instant now) {
        this.commandId = commandId;
        this.status = AgentTaskCommandDeliveryStatus.PENDING;
        this.attempts = 0;
        this.availableAt = now;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void claim(Instant now, Duration lease) {
        boolean pending = status == AgentTaskCommandDeliveryStatus.PENDING && !availableAt.isAfter(now);
        boolean expired = status == AgentTaskCommandDeliveryStatus.PROCESSING && leaseUntil != null && !leaseUntil.isAfter(now);
        if (!pending && !expired) throw new IllegalStateException("task command delivery is not claimable");
        if (lease.isZero() || lease.isNegative()) throw new IllegalArgumentException("lease must be positive");
        status = AgentTaskCommandDeliveryStatus.PROCESSING;
        attempts++;
        leaseUntil = now.plus(lease);
        updatedAt = now;
    }

    public boolean delivered(int claimedAttempt, Instant now) {
        if (!owns(claimedAttempt)) return false;
        status = AgentTaskCommandDeliveryStatus.DELIVERED;
        leaseUntil = null;
        lastError = null;
        updatedAt = now;
        return true;
    }

    public boolean retry(int claimedAttempt, Instant availableAt, String error, Instant now) {
        if (!owns(claimedAttempt)) return false;
        status = AgentTaskCommandDeliveryStatus.PENDING;
        this.availableAt = availableAt;
        leaseUntil = null;
        lastError = truncate(error);
        updatedAt = now;
        return true;
    }

    public boolean fail(int claimedAttempt, String error, Instant now) {
        if (!owns(claimedAttempt)) return false;
        status = AgentTaskCommandDeliveryStatus.FAILED;
        leaseUntil = null;
        lastError = truncate(error);
        updatedAt = now;
        return true;
    }

    private boolean owns(int claimedAttempt) {
        return status == AgentTaskCommandDeliveryStatus.PROCESSING && attempts == claimedAttempt;
    }

    private static String truncate(String value) {
        if (value == null) return null;
        return value.length() <= 500 ? value : value.substring(0, 500);
    }

    public UUID commandId() { return commandId; }
    public AgentTaskCommandDeliveryStatus status() { return status; }
    public int attempts() { return attempts; }
}
