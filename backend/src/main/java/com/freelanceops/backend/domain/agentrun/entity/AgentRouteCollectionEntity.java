package com.freelanceops.backend.domain.agentrun.entity;

import com.freelanceops.backend.domain.agentrun.model.RouteCollectionStatus;
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
@Table(name = "agent_route_collection", schema = "app")
public class AgentRouteCollectionEntity {
    @Id @Column(name = "agent_run_id") private UUID agentRunId;
    @Column(name = "cursor_event_id", nullable = false) private long cursorEventId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private RouteCollectionStatus status;
    @Column(nullable = false) private int attempts;
    @Column(name = "available_at", nullable = false) private Instant availableAt;
    @Column(name = "lease_until") private Instant leaseUntil;
    @Column(name = "last_error", length = 500) private String lastError;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private long version;

    protected AgentRouteCollectionEntity() { }

    public AgentRouteCollectionEntity(UUID agentRunId, Instant now) {
        this.agentRunId = agentRunId;
        this.cursorEventId = 0;
        this.status = RouteCollectionStatus.PENDING;
        this.availableAt = now;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void claim(Instant now, Duration lease) {
        if (!dispatchableAt(now)) throw new IllegalStateException("route collection is not dispatchable");
        status = RouteCollectionStatus.PROCESSING;
        attempts++;
        leaseUntil = now.plus(lease);
        updatedAt = now;
    }

    public boolean record(Instant now, long nextCursor, boolean complete, Duration nextDelay, int claimedAttempt) {
        if (!ownsClaim(claimedAttempt) || nextCursor < cursorEventId) return false;
        cursorEventId = nextCursor;
        status = complete ? RouteCollectionStatus.COMPLETED : RouteCollectionStatus.PENDING;
        availableAt = complete ? now : now.plus(nextDelay);
        leaseUntil = null;
        lastError = null;
        updatedAt = now;
        return true;
    }

    public boolean retry(Instant now, Duration delay, String error, int claimedAttempt) {
        if (!ownsClaim(claimedAttempt)) return false;
        status = RouteCollectionStatus.PENDING;
        availableAt = now.plus(delay);
        leaseUntil = null;
        lastError = truncate(error);
        updatedAt = now;
        return true;
    }

    private boolean dispatchableAt(Instant now) {
        return status == RouteCollectionStatus.PENDING && !availableAt.isAfter(now)
            || status == RouteCollectionStatus.PROCESSING && leaseUntil != null && !leaseUntil.isAfter(now);
    }

    private boolean ownsClaim(int claimedAttempt) {
        return status == RouteCollectionStatus.PROCESSING && attempts == claimedAttempt;
    }

    private static String truncate(String value) {
        if (value == null) return null;
        return value.length() <= 500 ? value : value.substring(0, 500);
    }

    public UUID agentRunId() { return agentRunId; }
    public long cursorEventId() { return cursorEventId; }
    public int attempts() { return attempts; }
    public RouteCollectionStatus status() { return status; }
}
