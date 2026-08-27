package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.AgentRouteLabel;
import com.freelanceops.backend.domain.agentrun.model.RouteCorrectionSource;
import com.freelanceops.backend.domain.agentrun.model.RouteReviewStatus;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record RouteObservationReviewResponse(
    UUID id,
    UUID runId,
    long eventId,
    UUID projectId,
    Instant occurredAt,
    Map<String, Object> routeData,
    AgentRouteLabel goldRoute,
    RouteCorrectionSource correctionSource,
    Instant reviewedAt,
    Instant claimExpiresAt,
    int reviewTarget,
    int reviewVotes,
    RouteReviewStatus reviewStatus
) { }
