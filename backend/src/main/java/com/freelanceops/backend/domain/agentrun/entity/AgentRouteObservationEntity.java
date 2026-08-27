package com.freelanceops.backend.domain.agentrun.entity;

import com.freelanceops.backend.domain.agentrun.model.AgentRouteLabel;
import com.freelanceops.backend.domain.agentrun.model.RouteCorrectionSource;
import com.freelanceops.backend.domain.agentrun.model.RouteReviewStatus;
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
import java.util.UUID;

@Entity
@Table(name = "agent_route_observation", schema = "app")
public class AgentRouteObservationEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "project_id", nullable = false) private UUID projectId;
    @Column(name = "agent_run_id", nullable = false) private UUID agentRunId;
    @Column(name = "agent_event_id", nullable = false) private long agentEventId;
    @Column(name = "occurred_at", nullable = false) private Instant occurredAt;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name = "route_data", nullable = false) private Map<String, Object> routeData;
    @Column(name = "captured_at", nullable = false) private Instant capturedAt;
    @Enumerated(EnumType.STRING) @Column(name = "gold_route", length = 30) private AgentRouteLabel goldRoute;
    @Enumerated(EnumType.STRING) @Column(name = "correction_source", length = 30) private RouteCorrectionSource correctionSource;
    @Column(name = "reviewed_by") private UUID reviewedBy;
    @Column(name = "reviewed_at") private Instant reviewedAt;
    @Column(name = "review_claimed_by") private UUID reviewClaimedBy;
    @Column(name = "review_lease_until") private Instant reviewLeaseUntil;
    @Column(name = "review_target", nullable = false) private int reviewTarget;
    @Column(name = "review_votes", nullable = false) private int reviewVotes;
    @Enumerated(EnumType.STRING) @Column(name = "review_status", nullable = false, length = 20)
    private RouteReviewStatus reviewStatus;
    @Version private long version;

    protected AgentRouteObservationEntity() { }

    public AgentRouteObservationEntity(UUID id, UUID workspaceId, UUID projectId, UUID agentRunId,
                                       long agentEventId, Instant occurredAt, Map<String, Object> routeData,
                                       Instant capturedAt) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.projectId = projectId;
        this.agentRunId = agentRunId;
        this.agentEventId = agentEventId;
        this.occurredAt = occurredAt;
        this.routeData = Map.copyOf(routeData);
        this.capturedAt = capturedAt;
        this.reviewTarget = 1;
        this.reviewVotes = 0;
        this.reviewStatus = RouteReviewStatus.PENDING;
    }

    public void claimReview(UUID reviewer, Instant now, Duration lease) {
        if (reviewedAt != null) throw new IllegalStateException("route observation was already reviewed");
        if (reviewLeaseUntil != null && reviewLeaseUntil.isAfter(now) && !reviewer.equals(reviewClaimedBy)) {
            throw new IllegalStateException("route observation is claimed by another reviewer");
        }
        reviewClaimedBy = reviewer;
        reviewLeaseUntil = now.plus(lease);
    }

    public void configureReviewTarget(int target) {
        if (reviewVotes != 0 || reviewStatus != RouteReviewStatus.PENDING || target < 1 || target > 3) {
            throw new IllegalStateException("review target can only be configured before voting");
        }
        reviewTarget = target;
    }

    public void requireActiveClaim(UUID reviewer, Instant now) {
        if (reviewedAt != null) throw new IllegalStateException("route observation was already reviewed");
        if (!reviewer.equals(reviewClaimedBy) || reviewLeaseUntil == null || !reviewLeaseUntil.isAfter(now)) {
            throw new IllegalStateException("route observation requires an active review claim");
        }
    }

    public void recordVote() {
        reviewVotes++;
    }

    public void releaseReviewClaim() {
        reviewClaimedBy = null;
        reviewLeaseUntil = null;
    }

    public void requireAdjudication() {
        reviewTarget = 3;
        reviewStatus = RouteReviewStatus.ADJUDICATION;
        releaseReviewClaim();
    }

    public void completeReview(AgentRouteLabel goldRoute, RouteCorrectionSource source, UUID reviewer, Instant now) {
        if (source == RouteCorrectionSource.POLICY_REPLAY) {
            throw new IllegalArgumentException("interactive review cannot use POLICY_REPLAY source");
        }
        this.goldRoute = goldRoute;
        this.correctionSource = source;
        this.reviewedBy = reviewer;
        this.reviewedAt = now;
        this.reviewStatus = RouteReviewStatus.COMPLETED;
        releaseReviewClaim();
    }

    public UUID id() { return id; }
    public UUID workspaceId() { return workspaceId; }
    public UUID projectId() { return projectId; }
    public UUID agentRunId() { return agentRunId; }
    public long agentEventId() { return agentEventId; }
    public Instant occurredAt() { return occurredAt; }
    public Map<String, Object> routeData() { return routeData; }
    public Instant capturedAt() { return capturedAt; }
    public AgentRouteLabel goldRoute() { return goldRoute; }
    public RouteCorrectionSource correctionSource() { return correctionSource; }
    public Instant reviewedAt() { return reviewedAt; }
    public UUID reviewClaimedBy() { return reviewClaimedBy; }
    public Instant reviewLeaseUntil() { return reviewLeaseUntil; }
    public int reviewTarget() { return reviewTarget; }
    public int reviewVotes() { return reviewVotes; }
    public RouteReviewStatus reviewStatus() { return reviewStatus; }
}
