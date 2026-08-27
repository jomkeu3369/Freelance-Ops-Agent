package com.freelanceops.backend.domain.agentrun.repository;

public interface RouteReviewCheckpointStatsProjection {
    long getRiskAvailable();
    long getRiskSampled();
    long getRiskOverturns();
    long getNaturalAvailable();
    long getNaturalSampled();
    long getNaturalOverturns();
}
