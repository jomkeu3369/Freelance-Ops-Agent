package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.AgentRouteLabel;

import java.util.List;
import java.util.UUID;

public record RouteAdjudicationContextResponse(
    UUID observationId,
    List<AgentRouteLabel> priorVotes
) { }
