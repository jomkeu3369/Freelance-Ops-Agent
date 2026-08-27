package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.model.RouteCollectionStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteCollectionRepository;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteObservationRepository;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AgentRoutePipelineMetricsTest {
    @Test
    void exposesLowCardinalityBacklogLagAndOutcomeMetrics() {
        var registry = new SimpleMeterRegistry();
        var collectionRepository = mock(AgentRouteCollectionRepository.class);
        var observationRepository = mock(AgentRouteObservationRepository.class);
        when(collectionRepository.countByStatusNot(RouteCollectionStatus.COMPLETED)).thenReturn(7L);
        when(observationRepository.countByReviewedAtIsNull()).thenReturn(11L);
        when(collectionRepository.oldestIncompleteAvailableAt())
            .thenReturn(Optional.of(Instant.now().minusSeconds(30)));
        when(observationRepository.oldestUnreviewedOccurredAt())
            .thenReturn(Optional.of(Instant.now().minusSeconds(60)));
        var metrics = new AgentRoutePipelineMetrics(registry, collectionRepository, observationRepository);

        metrics.refresh();
        metrics.recordCollection(3, 1_000_000);
        metrics.recordRetry(2_000_000);
        metrics.recordClaims(2);
        metrics.recordReviewVote();
        metrics.recordReviewCompleted();

        assertThat(registry.get("freelance_ops.route.collection.backlog").gauge().value()).isEqualTo(7);
        assertThat(registry.get("freelance_ops.route.review.backlog").gauge().value()).isEqualTo(11);
        assertThat(registry.get("freelance_ops.route.collection.oldest.lag.seconds").gauge().value())
            .isBetween(29.0, 31.0);
        assertThat(registry.get("freelance_ops.route.review.oldest.age.seconds").gauge().value())
            .isBetween(59.0, 61.0);
        assertThat(registry.get("freelance_ops.route.observations.captured").counter().count()).isEqualTo(3);
        assertThat(registry.get("freelance_ops.route.collection.retries").counter().count()).isEqualTo(1);
        assertThat(registry.get("freelance_ops.route.review.claims").counter().count()).isEqualTo(2);
        assertThat(registry.get("freelance_ops.route.review.votes").counter().count()).isEqualTo(1);
        assertThat(registry.get("freelance_ops.route.review.completed").counter().count()).isEqualTo(1);
        assertThat(registry.get("freelance_ops.route.collection.snapshot.latency").timer().count()).isEqualTo(2);
    }
}
