package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.client.ResourceAccessException;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AgentRunReconcilerTest {

    @Mock private AgentRunRepository repository;
    @Mock private AgentRunClient client;
    @Mock private DelegationTokenIssuer tokenIssuer;
    @Mock private AgentRunProjectionService projectionService;
    private AgentRunReconciler reconciler;

    @BeforeEach
    void setUp() {
        reconciler = new AgentRunReconciler(repository, client, tokenIssuer, projectionService);
    }

    @Test
    void synchronizesAnActiveRunWithoutWaitingForAUserPoll() {
        AgentRunEntity run = run();
        Instant attemptedAt = Instant.parse("2026-08-24T00:00:00Z");
        AgentRunView completed = new AgentRunView(
            run.id(), AgentRunStatus.COMPLETED, null, null, null, null, null, null, attemptedAt
        );
        when(tokenIssuer.issue(run.id(), run.workspaceId(), run.projectId(), run.initiatedBy(), List.of("agent.run")))
            .thenReturn("token");
        when(client.get(org.mockito.ArgumentMatchers.eq(run.id()), org.mockito.ArgumentMatchers.eq("token"), anyString()))
            .thenReturn(completed);

        reconciler.reconcile(run, attemptedAt);

        verify(projectionService).synchronize(run.id(), run.workspaceId(), completed);
        verify(projectionService, never()).deferReconciliation(
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any()
        );
    }

    @Test
    void defersOnlyTheUnavailableRunSoOtherRunsAreNotStarved() {
        AgentRunEntity run = run();
        Instant attemptedAt = Instant.parse("2026-08-24T00:00:00Z");
        when(tokenIssuer.issue(run.id(), run.workspaceId(), run.projectId(), run.initiatedBy(), List.of("agent.run")))
            .thenReturn("token");
        when(client.get(org.mockito.ArgumentMatchers.eq(run.id()), org.mockito.ArgumentMatchers.eq("token"), anyString()))
            .thenThrow(new ResourceAccessException("unavailable"));

        reconciler.reconcile(run, attemptedAt);

        verify(projectionService).deferReconciliation(
            run.id(), run.workspaceId(), attemptedAt.plusSeconds(15)
        );
    }

    private static AgentRunEntity run() {
        return new AgentRunEntity(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            Provider.OPENAI, "gpt-test", AgentRunStatus.RUNNING, Instant.now()
        );
    }
}
