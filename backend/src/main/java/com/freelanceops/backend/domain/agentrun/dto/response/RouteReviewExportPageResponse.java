package com.freelanceops.backend.domain.agentrun.dto.response;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record RouteReviewExportPageResponse(
    Instant since,
    Instant until,
    Instant snapshotAt,
    List<RouteObservationExportResponse> observations,
    List<RouteGoldReviewExportResponse> reviews,
    Instant nextOccurredAt,
    UUID nextObservationId,
    boolean hasMore
) { }
