package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.AgentRouteLabel;
import com.freelanceops.backend.domain.agentrun.model.RouteCorrectionSource;

import java.util.UUID;

public record RouteGoldReviewExportResponse(
    UUID runId,
    long eventId,
    UUID workspaceId,
    AgentRouteLabel goldRoute,
    RouteCorrectionSource correctionSource
) { }
