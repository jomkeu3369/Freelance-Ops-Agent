package com.freelanceops.backend.domain.agentrun.dto.request;

import com.freelanceops.backend.domain.agentrun.model.AgentRouteLabel;
import com.freelanceops.backend.domain.agentrun.model.RouteCorrectionSource;
import jakarta.validation.constraints.NotNull;

public record ReviewRouteObservationRequest(
    @NotNull AgentRouteLabel goldRoute,
    @NotNull RouteCorrectionSource correctionSource
) { }
