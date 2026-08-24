package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView.AgentRunMetadata;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.SafetyContext;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.InterruptionKind;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.times;

@ExtendWith(MockitoExtension.class)
class AgentRunGatewayServiceTest {

    @Mock
    private WorkspacePermissionReader permissionReader;
    @Mock
    private ProjectRepository projectRepository;
    @Mock
    private AgentRunRepository agentRunRepository;
    @Mock
    private DelegationTokenIssuer tokenIssuer;
    @Mock
    private AgentRunClient agentRunClient;
    @Mock
    private AgentRunProjectionService projectionService;
    @Mock
    private AgentRunCommandQueue commandQueue;
    @Mock
    private AgentBudgetPolicy budgetPolicy;

    private AgentRunGatewayService service;

    @BeforeEach
    void setUp() {
        service = new AgentRunGatewayService(
            permissionReader,
            projectRepository,
            agentRunRepository,
            tokenIssuer,
            agentRunClient,
            projectionService,
            commandQueue,
            budgetPolicy
        );
    }

    @Test
    void validatesWorkspacePermissionsAndPersistsAStartCommandWithTheRun() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        when(permissionReader.findActiveMembership(userId, workspaceId)).thenReturn(Optional.of(new MembershipPermissions(
            UUID.randomUUID(),
            Set.of(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ)
        )));
        when(projectRepository.findByIdAndWorkspaceIdForUpdate(projectId, workspaceId)).thenReturn(Optional.of(project(projectId, workspaceId)));
        StartAgentRunResponse response = service.start(userId, workspaceId, projectId, request(), "traceparent");

        ArgumentCaptor<InternalAgentRunRequest> captor = ArgumentCaptor.forClass(InternalAgentRunRequest.class);
        verify(commandQueue).enqueueStart(eq(response.runId()), captor.capture(), eq(userId),
            eq(List.of("agent.run", "project.read")), eq("traceparent"));
        verify(agentRunRepository).saveAndFlush(any(AgentRunEntity.class));
        assertThat(response.runId()).isEqualTo(captor.getValue().context().runId());
        assertThat(captor.getValue().context().workspaceId()).isEqualTo(workspaceId);
        assertThat(captor.getValue().context().effectivePermissions()).containsExactly("agent.run", "project.read");
        assertThat(captor.getValue().input().requirementText()).isEqualTo("쇼핑몰 요구사항을 분석해 주세요.");
    }

    @Test
    void failsClosedBeforeProjectLookupWithoutAgentPermission() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(permissionReader.findActiveMembership(userId, workspaceId)).thenReturn(Optional.of(new MembershipPermissions(
            UUID.randomUUID(),
            Set.of(PermissionCode.PROJECT_READ)
        )));

        assertThatThrownBy(() -> service.start(userId, workspaceId, UUID.randomUUID(), request(), "traceparent"))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode().value()).isEqualTo(403));
        verify(projectRepository, never()).findByIdAndWorkspaceIdForUpdate(any(), any());
        verify(agentRunClient, never()).start(any(), any(), any());
    }

    @Test
    void rechecksCurrentPermissionAndReissuesTokenForRunLookup() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AgentRunEntity run = run(runId, workspaceId, projectId, userId);
        when(permissionReader.findActiveMembership(userId, workspaceId)).thenReturn(Optional.of(new MembershipPermissions(
            UUID.randomUUID(),
            Set.of(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ)
        )));
        when(agentRunRepository.findByIdAndWorkspaceId(runId, workspaceId)).thenReturn(Optional.of(run));
        when(tokenIssuer.issue(eq(runId), eq(workspaceId), eq(projectId), eq(userId), anyList())).thenReturn("fresh-token");
        when(agentRunClient.get(runId, "fresh-token", "traceparent")).thenReturn(view(runId, AgentRunStatus.RUNNING));

        AgentRunView response = service.get(userId, workspaceId, runId, "traceparent");

        assertThat(response.status()).isEqualTo(AgentRunStatus.RUNNING);
        verify(projectionService).synchronize(runId, workspaceId, response);
    }

    @Test
    void restoresLatestProjectRunAndSynchronizesItsCurrentStatus() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AgentRunEntity run = run(runId, workspaceId, projectId, userId);
        when(permissionReader.findActiveMembership(userId, workspaceId)).thenReturn(Optional.of(new MembershipPermissions(
            UUID.randomUUID(),
            Set.of(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ)
        )));
        when(projectRepository.findByIdAndWorkspaceId(projectId, workspaceId)).thenReturn(Optional.of(project(projectId, workspaceId)));
        when(agentRunRepository.findFirstByWorkspaceIdAndProjectIdOrderByUpdatedAtDesc(workspaceId, projectId)).thenReturn(Optional.of(run));
        when(agentRunRepository.findByIdAndWorkspaceId(runId, workspaceId)).thenReturn(Optional.of(run));
        when(tokenIssuer.issue(eq(runId), eq(workspaceId), eq(projectId), eq(userId), anyList())).thenReturn("fresh-token");
        when(agentRunClient.get(runId, "fresh-token", "traceparent")).thenReturn(view(runId, AgentRunStatus.WAITING_FOR_USER));

        Optional<AgentRunView> response = service.latestForProject(userId, workspaceId, projectId, "traceparent");

        assertThat(response).isPresent().get().extracting(AgentRunView::status).isEqualTo(AgentRunStatus.WAITING_FOR_USER);
        verify(projectionService).synchronize(runId, workspaceId, response.orElseThrow());
    }

    @Test
    void cancelsEveryActiveProjectRunBeforePermanentDeletion() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID completedRunId = UUID.randomUUID();
        UUID waitingRunId = UUID.randomUUID();
        AgentRunEntity completedRun = run(completedRunId, workspaceId, projectId, userId);
        AgentRunEntity waitingRun = run(waitingRunId, workspaceId, projectId, userId);
        when(permissionReader.findActiveMembership(userId, workspaceId)).thenReturn(Optional.of(new MembershipPermissions(
            UUID.randomUUID(),
            Set.of(PermissionCode.PROJECT_READ, PermissionCode.AGENT_RUN, PermissionCode.AGENT_CANCEL)
        )));
        when(projectRepository.findByIdAndWorkspaceId(projectId, workspaceId)).thenReturn(Optional.of(project(projectId, workspaceId)));
        when(agentRunRepository.findAllByWorkspaceIdAndProjectIdAndStatusIn(eq(workspaceId), eq(projectId), any()))
            .thenReturn(List.of(completedRun, waitingRun));
        when(agentRunRepository.findByIdAndWorkspaceId(completedRunId, workspaceId)).thenReturn(Optional.of(completedRun));
        when(agentRunRepository.findByIdAndWorkspaceId(waitingRunId, workspaceId)).thenReturn(Optional.of(waitingRun));
        when(tokenIssuer.issue(eq(completedRunId), eq(workspaceId), eq(projectId), eq(userId), anyList())).thenReturn("completed-token");
        when(tokenIssuer.issue(eq(waitingRunId), eq(workspaceId), eq(projectId), eq(userId), anyList())).thenReturn("waiting-token");
        when(agentRunClient.get(completedRunId, "completed-token", "traceparent")).thenReturn(view(completedRunId, AgentRunStatus.COMPLETED));
        when(agentRunClient.get(waitingRunId, "waiting-token", "traceparent")).thenReturn(view(waitingRunId, AgentRunStatus.WAITING_FOR_USER));
        when(agentRunClient.cancel(waitingRunId, "waiting-token", "traceparent")).thenReturn(view(waitingRunId, AgentRunStatus.CANCELLED));

        service.cancelActiveForProject(userId, workspaceId, projectId, "traceparent");

        verify(agentRunClient, never()).cancel(eq(completedRunId), any(), any());
        verify(agentRunClient).cancel(waitingRunId, "waiting-token", "traceparent");
        verify(projectionService).synchronize(eq(completedRunId), eq(workspaceId), any(AgentRunView.class));
        verify(projectionService, org.mockito.Mockito.times(2)).synchronize(eq(waitingRunId), eq(workspaceId), any(AgentRunView.class));
    }

    @Test
    void doesNotCallTheAgentBeforeTheStartTransactionCommits() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        when(permissionReader.findActiveMembership(userId, workspaceId)).thenReturn(Optional.of(new MembershipPermissions(
            UUID.randomUUID(), Set.of(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ)
        )));
        when(projectRepository.findByIdAndWorkspaceIdForUpdate(projectId, workspaceId)).thenReturn(Optional.of(project(projectId, workspaceId)));
        StartAgentRunResponse response = service.start(userId, workspaceId, projectId, request(), "traceparent");

        verify(commandQueue).enqueueStart(eq(response.runId()), any(), eq(userId), anyList(), eq("traceparent"));
        verify(agentRunClient, never()).start(any(), any(), any());
    }

    @Test
    void projectDeletionUsesServerOwnedCleanupAuthorityAndRequiresCancellationAcknowledgement() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AgentRunEntity run = run(runId, workspaceId, projectId, userId);
        when(permissionReader.findActiveMembership(userId, workspaceId)).thenReturn(Optional.of(new MembershipPermissions(
            UUID.randomUUID(), Set.of(PermissionCode.PROJECT_DELETE)
        )));
        when(projectRepository.findByIdAndWorkspaceId(projectId, workspaceId)).thenReturn(Optional.of(project(projectId, workspaceId)));
        when(agentRunRepository.findAllByWorkspaceIdAndProjectIdAndStatusIn(eq(workspaceId), eq(projectId), any()))
            .thenReturn(List.of(run));
        when(tokenIssuer.issue(eq(runId), eq(workspaceId), eq(projectId), eq(userId), argThat(permissions ->
            permissions.contains("project.delete") && permissions.contains("agent.run") && permissions.contains("agent.cancel")
        ))).thenReturn("cleanup-token");
        when(agentRunClient.get(runId, "cleanup-token", "traceparent"))
            .thenReturn(view(runId, AgentRunStatus.RUNNING));
        when(agentRunClient.cancel(runId, "cleanup-token", "traceparent"))
            .thenReturn(view(runId, AgentRunStatus.CANCELLED));

        service.cancelActiveRuns(userId, workspaceId, projectId, "traceparent");

        verify(projectionService, org.mockito.Mockito.times(2)).synchronize(eq(runId), eq(workspaceId), any(AgentRunView.class));
    }

    @Test
    void retiresAnActiveRunMissingFromTheAgentRuntimeBeforePermanentDeletion() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AgentRunEntity missingRun = run(runId, workspaceId, projectId, userId);
        when(permissionReader.findActiveMembership(userId, workspaceId)).thenReturn(Optional.of(new MembershipPermissions(
            UUID.randomUUID(),
            Set.of(PermissionCode.PROJECT_READ, PermissionCode.AGENT_RUN, PermissionCode.AGENT_CANCEL)
        )));
        when(projectRepository.findByIdAndWorkspaceId(projectId, workspaceId)).thenReturn(Optional.of(project(projectId, workspaceId)));
        when(agentRunRepository.findAllByWorkspaceIdAndProjectIdAndStatusIn(eq(workspaceId), eq(projectId), any()))
            .thenReturn(List.of(missingRun));
        when(agentRunRepository.findByIdAndWorkspaceId(runId, workspaceId)).thenReturn(Optional.of(missingRun));
        when(tokenIssuer.issue(eq(runId), eq(workspaceId), eq(projectId), eq(userId), anyList())).thenReturn("missing-token");
        when(agentRunClient.get(runId, "missing-token", "traceparent"))
            .thenThrow(new HttpClientErrorException(HttpStatus.NOT_FOUND));

        service.cancelActiveForProject(userId, workspaceId, projectId, "traceparent");

        verify(projectionService).synchronizeStatus(runId, workspaceId, AgentRunStatus.CANCELLED);
        verify(agentRunClient, never()).cancel(eq(runId), any(), any());
    }

    @Test
    void doesNotRetireAnActiveRunWhenTheAgentRuntimeIsUnavailable() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AgentRunEntity activeRun = run(runId, workspaceId, projectId, userId);
        when(permissionReader.findActiveMembership(userId, workspaceId)).thenReturn(Optional.of(new MembershipPermissions(
            UUID.randomUUID(),
            Set.of(PermissionCode.PROJECT_READ, PermissionCode.AGENT_RUN, PermissionCode.AGENT_CANCEL)
        )));
        when(projectRepository.findByIdAndWorkspaceId(projectId, workspaceId)).thenReturn(Optional.of(project(projectId, workspaceId)));
        when(agentRunRepository.findAllByWorkspaceIdAndProjectIdAndStatusIn(eq(workspaceId), eq(projectId), any()))
            .thenReturn(List.of(activeRun));
        when(agentRunRepository.findByIdAndWorkspaceId(runId, workspaceId)).thenReturn(Optional.of(activeRun));
        when(tokenIssuer.issue(eq(runId), eq(workspaceId), eq(projectId), eq(userId), anyList())).thenReturn("unavailable-token");
        when(agentRunClient.get(runId, "unavailable-token", "traceparent"))
            .thenThrow(new HttpClientErrorException(HttpStatus.SERVICE_UNAVAILABLE));

        assertThatThrownBy(() -> service.cancelActiveForProject(userId, workspaceId, projectId, "traceparent"))
            .isInstanceOf(HttpClientErrorException.class)
            .extracting(error -> ((HttpClientErrorException) error).getStatusCode())
            .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);

        assertThat(activeRun.status()).isEqualTo(AgentRunStatus.QUEUED);
        verify(agentRunRepository, never()).save(activeRun);
    }

    @Test
    void atomicallyConsumesTheInterruptionAndPersistsAResumeCommand() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID interruptionId = UUID.randomUUID();
        AgentRunEntity run = run(runId, workspaceId, projectId, userId);
        ResumeAgentRunRequest request = new ResumeAgentRunRequest(
            interruptionId, "idempotency-key", List.of(new ResumeAgentRunRequest.ResumeAnswer(0, "예산은 500만원입니다."))
        );
        when(permissionReader.findActiveMembership(userId, workspaceId)).thenReturn(Optional.of(new MembershipPermissions(
            UUID.randomUUID(), Set.of(PermissionCode.AGENT_RESPOND)
        )));
        when(agentRunRepository.findByIdAndWorkspaceId(runId, workspaceId)).thenReturn(Optional.of(run));
        when(projectRepository.findByIdAndWorkspaceIdForUpdate(projectId, workspaceId))
            .thenReturn(Optional.of(project(projectId, workspaceId)));

        StartAgentRunResponse response = service.resume(userId, workspaceId, runId, request, "traceparent");

        assertThat(response.status()).isEqualTo(AgentRunStatus.QUEUED);
        verify(projectionService).validateResume(runId, workspaceId, request);
        verify(commandQueue).enqueueResume(runId, request, userId, List.of("agent.respond"), "traceparent");
        verify(projectionService).acceptResume(runId, workspaceId, request, AgentRunStatus.QUEUED);
        verify(agentRunClient, never()).resume(any(), any(), any(), any());
    }

    @Test
    void hidesRunFromAnotherWorkspaceBeforeCallingAgent() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        when(permissionReader.findActiveMembership(userId, workspaceId)).thenReturn(Optional.of(new MembershipPermissions(
            UUID.randomUUID(),
            Set.of(PermissionCode.AGENT_RUN)
        )));
        when(agentRunRepository.findByIdAndWorkspaceId(runId, workspaceId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.get(userId, workspaceId, runId, "traceparent"))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode().value()).isEqualTo(404));
        verify(agentRunClient, never()).get(any(), any(), any());
    }

    private static ProjectEntity project(UUID projectId, UUID workspaceId) {
        return new ProjectEntity(projectId, workspaceId, "쇼핑몰", "요구사항", "KRW", null, null, null);
    }

    private static AgentRunEntity run(UUID runId, UUID workspaceId, UUID projectId, UUID userId) {
        return new AgentRunEntity(
            runId,
            workspaceId,
            projectId,
            UUID.randomUUID(),
            userId,
            Provider.OPENAI,
            "gpt-test",
            AgentRunStatus.QUEUED,
            Instant.now()
        );
    }

    private static AgentRunView view(UUID runId, AgentRunStatus status) {
        return new AgentRunView(
            runId,
            status,
            null,
            null,
            null,
            null,
            new AgentRunMetadata(Provider.OPENAI, "gpt-test", "v1", "v1", "trace"),
            null,
            Instant.now()
        );
    }

    private static AgentRunView interruptedView(UUID runId, UUID interruptionId) {
        return new AgentRunView(
            runId,
            AgentRunStatus.WAITING_FOR_USER,
            null,
            new AgentRunView.AgentInterruption(interruptionId, InterruptionKind.CLARIFICATION, List.of("예산은 얼마인가요?")),
            null,
            null,
            new AgentRunMetadata(Provider.OPENAI, "gpt-test", "v1", "v1", "trace"),
            null,
            Instant.now()
        );
    }

    private static StartAgentRunRequest request() {
        return new StartAgentRunRequest(
            "쇼핑몰 요구사항을 분석해 주세요.",
            "ko-KR",
            "KR",
            new ModelSelection(Provider.OPENAI, "gpt-test", ReasoningEffort.LOW),
            new RunBudget(120, 5, 10, 10000, 5000, 2, 2, 5, 1, 2),
            new SafetyContext(false, false, false, false, false, false, true)
        );
    }
}


