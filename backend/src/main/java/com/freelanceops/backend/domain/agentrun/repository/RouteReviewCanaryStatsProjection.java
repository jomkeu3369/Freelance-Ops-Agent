package com.freelanceops.backend.domain.agentrun.repository;

public interface RouteReviewCanaryStatsProjection {
    long getCompletedGold();
    long getPendingAdjudications();
    long getSeniorAudits();
    long getDualCompleted();
    long getDisagreements();
    long getRiskConsensusAudits();
    long getRiskConsensusOverturns();
    long getNaturalConsensusAudits();
    long getNaturalConsensusOverturns();
}
