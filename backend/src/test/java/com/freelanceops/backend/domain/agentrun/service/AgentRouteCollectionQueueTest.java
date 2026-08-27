package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunEvent;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteObservationBatch;
import com.freelanceops.backend.domain.agentrun.entity.AgentRouteCollectionEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRouteObservationEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.RouteCollectionStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteCollectionRepository;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteObservationRepository;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AgentRouteCollectionQueueTest {
    private final AgentRouteCollectionRepository collectionRepository = mock(AgentRouteCollectionRepository.class);
    private final AgentRouteObservationRepository observationRepository = mock(AgentRouteObservationRepository.class);
    private final AgentRunRepository runRepository = mock(AgentRunRepository.class);
    private final AgentRouteReviewPolicy reviewPolicy = new AgentRouteReviewPolicy(50, 5);
    private final AgentRouteCollectionQueue queue = new AgentRouteCollectionQueue(
        collectionRepository, observationRepository, runRepository, reviewPolicy
    );

    @Test
    void recordsAllowlistedSignalsAndDropsPrompt() {
        Instant now = Instant.parse("2026-08-27T00:00:00Z");
        AgentRunEntity run = run(now);
        AgentRouteCollectionEntity collection = claimed(run.id(), now);
        var claim = new AgentRouteCollectionQueue.ClaimedCollection(run.id(), 0, 1);
        when(collectionRepository.findByRunIdForUpdate(run.id())).thenReturn(Optional.of(collection));
        when(runRepository.findById(run.id())).thenReturn(Optional.of(run));
        when(observationRepository.existsByAgentRunIdAndAgentEventId(run.id(), 3)).thenReturn(false);
        RouteObservationBatch batch = new RouteObservationBatch(
            run.id(), AgentRunStatus.COMPLETED, List.of(new AgentRunEvent(
                3, run.id(), "route.selected", now, Map.of(
                    "route", "SIMPLE_LLM",
                    "evaluatorProvider", "OPENAI",
                    "evaluatorModel", "gpt-5.6-luna",
                    "routingInputTokens", 100,
                    "routingLatencyMs", 120.0,
                    "prompt", "must not persist"
                )
            )), 3, false, true
        );

        assertThat(queue.record(claim, batch)).isTrue();

        var captor = org.mockito.ArgumentCaptor.forClass(AgentRouteObservationEntity.class);
        verify(observationRepository).save(captor.capture());
        assertThat(captor.getValue().routeData()).containsEntry("route", "SIMPLE_LLM");
        assertThat(captor.getValue().routeData()).containsEntry("routingLatencyMs", 120.0);
        assertThat(captor.getValue().routeData()).containsEntry("evaluatorProvider", "OPENAI");
        assertThat(captor.getValue().routeData()).containsEntry("evaluatorModel", "gpt-5.6-luna");
        assertThat(captor.getValue().routeData()).containsEntry("routingInputTokens", 100L);
        assertThat(captor.getValue().routeData()).doesNotContainKey("prompt");
        assertThat(collection.cursorEventId()).isEqualTo(3);
        assertThat(collection.status()).isEqualTo(RouteCollectionStatus.COMPLETED);
    }

    @Test
    void rejectsInvalidRoutingTelemetryBeforeProjection() {
        assertThatThrownBy(() -> AgentRouteCollectionQueue.sanitize(Map.of(
            "route", "SIMPLE_LLM", "routingInputTokens", -1
        ))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AgentRouteCollectionQueue.sanitize(Map.of(
            "route", "SIMPLE_LLM", "shadowFusedShare", 1.1
        ))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AgentRouteCollectionQueue.sanitize(Map.of(
            "route", "SIMPLE_LLM", "evaluatorProvider", "UNKNOWN"
        ))).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsMismatchedOrNonIncreasingBatch() {
        Instant now = Instant.now();
        AgentRunEntity run = run(now);
        AgentRouteCollectionEntity collection = claimed(run.id(), now);
        when(collectionRepository.findByRunIdForUpdate(run.id())).thenReturn(Optional.of(collection));
        var claim = new AgentRouteCollectionQueue.ClaimedCollection(run.id(), 0, 1);
        RouteObservationBatch batch = new RouteObservationBatch(
            UUID.randomUUID(), AgentRunStatus.COMPLETED, List.of(), 0, false, true
        );

        assertThatThrownBy(() -> queue.record(claim, batch)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void duplicateDeliveryAdvancesCursorWithoutDuplicatingObservation() {
        Instant now = Instant.now();
        AgentRunEntity run = run(now);
        AgentRouteCollectionEntity collection = claimed(run.id(), now);
        var claim = new AgentRouteCollectionQueue.ClaimedCollection(run.id(), 0, 1);
        when(collectionRepository.findByRunIdForUpdate(run.id())).thenReturn(Optional.of(collection));
        when(runRepository.findById(run.id())).thenReturn(Optional.of(run));
        when(observationRepository.existsByAgentRunIdAndAgentEventId(run.id(), 3)).thenReturn(true);
        RouteObservationBatch batch = new RouteObservationBatch(
            run.id(), AgentRunStatus.COMPLETED, List.of(new AgentRunEvent(
                3, run.id(), "route.selected", now, Map.of("route", "SIMPLE_LLM")
            )), 3, false, true
        );

        assertThat(queue.record(claim, batch)).isTrue();

        verify(observationRepository, never()).save(any());
        assertThat(collection.cursorEventId()).isEqualTo(3);
    }

    @Test
    void staleLeaseCannotPersistObservation() {
        Instant now = Instant.now();
        AgentRunEntity run = run(now);
        AgentRouteCollectionEntity collection = claimed(run.id(), now);
        var staleClaim = new AgentRouteCollectionQueue.ClaimedCollection(run.id(), 0, 1);
        collection.retry(now, Duration.ZERO, "retry", 1);
        collection.claim(now, Duration.ofMinutes(2));
        when(collectionRepository.findByRunIdForUpdate(run.id())).thenReturn(Optional.of(collection));
        when(runRepository.findById(run.id())).thenReturn(Optional.of(run));
        RouteObservationBatch batch = new RouteObservationBatch(
            run.id(), AgentRunStatus.COMPLETED, List.of(new AgentRunEvent(
                3, run.id(), "route.selected", now, Map.of("route", "SIMPLE_LLM")
            )), 3, false, true
        );

        assertThat(queue.record(staleClaim, batch)).isFalse();

        verify(observationRepository, never()).save(any());
    }

    private static AgentRouteCollectionEntity claimed(UUID runId, Instant now) {
        AgentRouteCollectionEntity collection = new AgentRouteCollectionEntity(runId, now);
        collection.claim(now, Duration.ofMinutes(2));
        return collection;
    }

    private static AgentRunEntity run(Instant now) {
        return new AgentRunEntity(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            Provider.OPENAI, "gpt-5.6-luna", AgentRunStatus.RUNNING, now
        );
    }
}
