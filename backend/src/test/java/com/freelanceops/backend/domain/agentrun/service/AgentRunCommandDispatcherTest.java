package com.freelanceops.backend.domain.agentrun.service;

import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunCommandType;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.ResourceAccessException;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AgentRunCommandDispatcherTest {

    @Mock private AgentRunCommandQueue queue;
    @Mock private AgentRunRepository runRepository;
    @Mock private ProjectRepository projectRepository;
    @Mock private AgentRunClient client;
    @Mock private DelegationTokenIssuer tokenIssuer;
    @Mock private AgentRunProjectionService projectionService;
    private ObjectMapper objectMapper;
    private AgentRunCommandDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        objectMapper = JsonMapper.builder().findAndAddModules().build();
        dispatcher = new AgentRunCommandDispatcher(
            queue, runRepository, projectRepository, client, tokenIssuer, projectionService, objectMapper
        );
    }

    @Test
    void completesAStartCommandByReconciliationWhenTheResponseIsLost() throws Exception {
        Fixture fixture = fixture();
        InternalAgentRunRequest request = startRequest(fixture);
        var command = command(fixture, AgentRunCommandType.START, objectMapper.writeValueAsString(request), 1);
        when(client.start(request, "token", "traceparent"))
            .thenThrow(new ResourceAccessException("response lost"));
        AgentRunView running = view(fixture.runId(), AgentRunStatus.RUNNING, null);
        when(client.get(fixture.runId(), "token", "traceparent")).thenReturn(running);

        dispatcher.dispatch(command);

        verify(projectionService).synchronize(fixture.runId(), fixture.workspaceId(), running);
        verify(queue).complete(command.id(), command.attempts());
        verify(queue, never()).retry(any(), any(Integer.class), any(), any());
    }

    @Test
    void retriesAStartCommandWhenNeitherDeliveryNorReconciliationIsConclusive() throws Exception {
        Fixture fixture = fixture();
        InternalAgentRunRequest request = startRequest(fixture);
        var command = command(fixture, AgentRunCommandType.START, objectMapper.writeValueAsString(request), 2);
        when(client.start(request, "token", "traceparent"))
            .thenThrow(new ResourceAccessException("agent unavailable"));
        when(client.get(fixture.runId(), "token", "traceparent"))
            .thenThrow(new HttpClientErrorException(HttpStatus.NOT_FOUND));

        dispatcher.dispatch(command);

        verify(queue).retry(eq(command.id()), eq(command.attempts()), any(), any());
        verify(queue, never()).fail(any(), any(Integer.class), any());
    }

    @Test
    void treatsAnAlreadyConsumedResumeAsDeliveredAfterReconciliation() throws Exception {
        Fixture fixture = fixture();
        ResumeAgentRunRequest request = new ResumeAgentRunRequest(
            UUID.randomUUID(), "resume-key-123", List.of(new ResumeAgentRunRequest.ResumeAnswer(0, "답변"))
        );
        var command = command(fixture, AgentRunCommandType.RESUME, objectMapper.writeValueAsString(request), 2);
        when(client.resume(fixture.runId(), request, "token", "traceparent"))
            .thenThrow(new HttpClientErrorException(HttpStatus.CONFLICT));
        AgentRunView queued = view(fixture.runId(), AgentRunStatus.QUEUED, null);
        when(client.get(fixture.runId(), "token", "traceparent")).thenReturn(queued);

        dispatcher.dispatch(command);

        verify(projectionService).synchronize(fixture.runId(), fixture.workspaceId(), queued);
        verify(queue).complete(command.id(), command.attempts());
        verify(queue, never()).fail(any(), any(Integer.class), any());
    }

    private AgentRunCommandQueue.ClaimedCommand command(Fixture fixture, AgentRunCommandType type,
                                                         String payload, int attempts) {
        when(runRepository.findById(fixture.runId())).thenReturn(Optional.of(fixture.run()));
        when(projectRepository.findByIdAndWorkspaceId(fixture.projectId(), fixture.workspaceId()))
            .thenReturn(Optional.of(new ProjectEntity(
                fixture.projectId(), fixture.workspaceId(), "프로젝트", "요구사항", "KRW", null, null, null
            )));
        when(tokenIssuer.issue(fixture.runId(), fixture.workspaceId(), fixture.projectId(),
            fixture.userId(), List.of("agent.run", "agent.respond"))).thenReturn("token");
        return new AgentRunCommandQueue.ClaimedCommand(
            UUID.randomUUID(), fixture.runId(), type, payload, fixture.userId(),
            List.of("agent.run", "agent.respond"), "traceparent", attempts
        );
    }

    private static Fixture fixture() {
        UUID runId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        AgentRunEntity run = new AgentRunEntity(
            runId, workspaceId, projectId, UUID.randomUUID(), userId,
            Provider.OPENAI, "gpt-test", AgentRunStatus.QUEUED, Instant.now()
        );
        return new Fixture(runId, workspaceId, projectId, userId, run);
    }

    private static InternalAgentRunRequest startRequest(Fixture fixture) {
        return new InternalAgentRunRequest(
            new InternalAgentRunRequest.TrustedRunContext(
                fixture.runId(), UUID.randomUUID(), "trace", fixture.workspaceId(), fixture.projectId(),
                fixture.userId(), List.of("agent.run", "agent.respond")
            ),
            new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget(
                30, 1, 1, 1000, 1000, 1, 1, 0, 0, 0
            ),
            new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection(
                Provider.OPENAI, "gpt-test",
                com.freelanceops.backend.domain.agentrun.model.ReasoningEffort.LOW
            ),
            new com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.SafetyContext(
                false, false, false, false, false, false, true
            ),
            new InternalAgentRunRequest.AgentInput("요구사항", "ko-KR", "KR", null)
        );
    }

    private static AgentRunView view(UUID runId, AgentRunStatus status,
                                     AgentRunView.AgentInterruption interruption) {
        return new AgentRunView(runId, status, null, interruption, null, null, null, null, Instant.now());
    }

    private record Fixture(UUID runId, UUID workspaceId, UUID projectId, UUID userId, AgentRunEntity run) {
    }
}
