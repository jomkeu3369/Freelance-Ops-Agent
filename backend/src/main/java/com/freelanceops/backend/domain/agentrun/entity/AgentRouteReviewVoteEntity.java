package com.freelanceops.backend.domain.agentrun.entity;

import com.freelanceops.backend.domain.agentrun.model.AgentRouteLabel;
import com.freelanceops.backend.domain.agentrun.model.RouteCorrectionSource;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "agent_route_review_vote", schema = "app")
public class AgentRouteReviewVoteEntity {
    @Id private UUID id;
    @Column(name = "workspace_id", nullable = false) private UUID workspaceId;
    @Column(name = "observation_id", nullable = false) private UUID observationId;
    @Column(name = "reviewer_id", nullable = false) private UUID reviewerId;
    @Enumerated(EnumType.STRING) @Column(name = "gold_route", nullable = false, length = 30)
    private AgentRouteLabel goldRoute;
    @Enumerated(EnumType.STRING) @Column(name = "correction_source", nullable = false, length = 30)
    private RouteCorrectionSource correctionSource;
    @Column(name = "reviewed_at", nullable = false) private Instant reviewedAt;

    protected AgentRouteReviewVoteEntity() { }

    public AgentRouteReviewVoteEntity(UUID id, UUID workspaceId, UUID observationId, UUID reviewerId,
                                      AgentRouteLabel goldRoute, RouteCorrectionSource correctionSource,
                                      Instant reviewedAt) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.observationId = observationId;
        this.reviewerId = reviewerId;
        this.goldRoute = goldRoute;
        this.correctionSource = correctionSource;
        this.reviewedAt = reviewedAt;
    }

    public UUID reviewerId() { return reviewerId; }
    public AgentRouteLabel goldRoute() { return goldRoute; }
}
