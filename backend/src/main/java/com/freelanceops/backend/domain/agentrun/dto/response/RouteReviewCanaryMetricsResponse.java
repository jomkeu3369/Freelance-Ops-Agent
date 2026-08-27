package com.freelanceops.backend.domain.agentrun.dto.response;

import java.time.Instant;

public record RouteReviewCanaryMetricsResponse(
    Instant since,
    Instant generatedAt,
    int checkpoint,
    double simultaneousConfidence,
    long completedGold,
    long pendingAdjudications,
    long seniorAudits,
    long dualCompleted,
    long disagreements,
    long riskAvailableConsensusAudits,
    long naturalAvailableConsensusAudits,
    WilsonIntervalResponse riskConsensusOverturn,
    WilsonIntervalResponse naturalConsensusOverturn,
    String overallDecision
) {
}
