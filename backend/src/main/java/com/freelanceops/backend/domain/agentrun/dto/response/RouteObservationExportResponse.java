package com.freelanceops.backend.domain.agentrun.dto.response;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record RouteObservationExportResponse(
    UUID observationId,
    UUID runId,
    long eventId,
    UUID workspaceId,
    UUID projectId,
    Instant occurredAt,
    Map<String, Object> routeData,
    BigDecimal routingCostUsd,
    UUID pricingSnapshotId,
    String pricingVersion,
    String costCurrency
) { }
