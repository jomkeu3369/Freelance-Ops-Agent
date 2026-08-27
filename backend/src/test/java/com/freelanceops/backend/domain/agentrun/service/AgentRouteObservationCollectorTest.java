package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteObservationBatch;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AgentRouteObservationCollectorTest {
    private final AgentRouteCollectionQueue queue = mock(AgentRouteCollectionQueue.class);
    private final AgentRunRepository runRepository = mock(AgentRunRepository.class);
    private final AgentRunClient client = mock(AgentRunClient.class);
    private final DelegationTokenIssuer tokenIssuer = mock(DelegationTokenIssuer.class);
    private final AgentRouteObservationCollector collector = new AgentRouteObservationCollector(
        queue, runRepository, client, tokenIssuer, Optional.empty()
    );

    @Test
    void fetchesFiniteBatchFromClaimedCursor() {
        AgentRunEntity run = run();
        var claim = new AgentRouteCollectionQueue.ClaimedCollection(run.id(), 7, 1);
        RouteObservationBatch batch = new RouteObservationBatch(
            run.id(), AgentRunStatus.COMPLETED, List.of(), 7, false, true
        );
        when(runRepository.findById(run.id())).thenReturn(Optional.of(run));
        when(tokenIssuer.issue(run.id(), run.workspaceId(), run.projectId(), run.initiatedBy(), List.of("agent.run")))
            .thenReturn("token");
        when(client.routeObservations(eq(run.id()), eq(7L), eq("token"), anyString())).thenReturn(batch);

        collector.collect(claim);

        verify(queue).record(claim, batch);
    }

    @Test
    void retriesWithoutAdvancingCursorWhenAgentIsUnavailable() {
        AgentRunEntity run = run();
        var claim = new AgentRouteCollectionQueue.ClaimedCollection(run.id(), 7, 2);
        when(runRepository.findById(run.id())).thenReturn(Optional.of(run));
        when(tokenIssuer.issue(run.id(), run.workspaceId(), run.projectId(), run.initiatedBy(), List.of("agent.run")))
            .thenReturn("token");
        when(client.routeObservations(eq(run.id()), eq(7L), eq("token"), anyString()))
            .thenThrow(new IllegalStateException("offline"));

        collector.collect(claim);

        verify(queue).retry(eq(claim), eq(Duration.ofSeconds(2)), anyString());
    }

    private static AgentRunEntity run() {
        return new AgentRunEntity(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            Provider.OPENAI, "gpt-5.6-luna", AgentRunStatus.RUNNING, Instant.now()
        );
    }
}
