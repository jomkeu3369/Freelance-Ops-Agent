package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunCommandType;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpClientErrorException;
import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Independent regression: expiry must stop new work without inventing a lost delivery outcome. */
@ExtendWith(MockitoExtension.class)
class ByokDispatchSecurityReviewTest {
    @Mock private AgentRunCommandQueue queue;
    @Mock private AgentRunRepository runs;
    @Mock private ProjectRepository projects;
    @Mock private AgentRunClient client;
    @Mock private DelegationTokenIssuer tokens;
    @Mock private AgentRunProjectionService projection;
    @Mock private ByokExecutionService byok;
    private AgentRunCommandDispatcher dispatcher;
    private AgentRunEntity run;
    private AgentRunCommandQueue.ClaimedCommand command;

    @BeforeEach
    void setUp() {
        UUID user = UUID.randomUUID();
        UUID workspace = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        RunBudget budget = new RunBudget(30, 2, 3, 30000, 200, 1, 1, 0, 1, 0);
        run = new AgentRunEntity(UUID.randomUUID(), workspace, projectId, UUID.randomUUID(), user,
            Provider.OPENAI, "gpt-6-luna", ReasoningEffort.LOW, budget, AgentRunStatus.QUEUED, Instant.now());
        run.useCredential(UUID.randomUUID());
        List<String> permissions = List.of("agent.run", "project.read");
        command = new AgentRunCommandQueue.ClaimedCommand(UUID.randomUUID(), run.id(), AgentRunCommandType.START,
            "{}", user, permissions, "synthetic-trace", 2);
        when(runs.findById(run.id())).thenReturn(Optional.of(run));
        when(projects.findByIdAndWorkspaceId(projectId, workspace)).thenReturn(Optional.of(
            new ProjectEntity(projectId, workspace, "Synthetic project", "Synthetic input", "KRW", null, null, null)));
        when(tokens.issueForPersonalRun(run.id(), workspace, projectId, user, permissions, 30))
            .thenReturn("synthetic-delegation");
        when(byok.validateRun(run)).thenThrow(new ByokExecutionException(HttpStatus.GONE,
            "BYOK_SCOPE_EXPIRED", "Synthetic expired scope"));
        dispatcher = new AgentRunCommandDispatcher(queue, runs, projects, client, tokens, projection,
            JsonMapper.builder().findAndAddModules().build(), byok);
    }

    @ParameterizedTest
    @EnumSource(value = AgentRunStatus.class, names = {"COMPLETED", "RUNNING", "WAITING_FOR_USER"})
    void expiredDeliveryRetryRetainsAnAuthoritativeExistingAgentOutcome(AgentRunStatus status) {
        AgentRunView existing = new AgentRunView(run.id(), status, null, null, null, null, null, null, Instant.now());
        when(client.get(run.id(), "synthetic-delegation", "synthetic-trace")).thenReturn(existing);

        dispatcher.dispatch(command);

        verify(client, never()).start(any(), any(), any());
        verify(projection).synchronize(run.id(), run.workspaceId(), existing);
        verify(queue).complete(command.id(), command.attempts());
        verify(queue, never()).fail(any(), anyInt(), any());
        verify(projection, never()).synchronizeStatus(any(), any(), any());
    }

    @Test
    void expiredUndeliveredStartCanFailOnlyAfterReadOnlyReconciliation() {
        when(client.get(run.id(), "synthetic-delegation", "synthetic-trace"))
            .thenThrow(new HttpClientErrorException(HttpStatus.NOT_FOUND));
        when(queue.fail(eq(command.id()), eq(command.attempts()), any())).thenReturn(true);

        dispatcher.dispatch(command);

        verify(client).get(run.id(), "synthetic-delegation", "synthetic-trace");
        verify(client, never()).start(any(), any(), any());
        verify(queue).fail(eq(command.id()), eq(command.attempts()), any());
        verify(projection).synchronizeStatus(run.id(), run.workspaceId(), AgentRunStatus.FAILED);
        verify(queue, never()).complete(any(), anyInt());
    }
}
