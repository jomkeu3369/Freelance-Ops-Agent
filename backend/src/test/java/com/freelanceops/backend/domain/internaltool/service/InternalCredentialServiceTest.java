package com.freelanceops.backend.domain.internaltool.service;

import com.freelanceops.backend.domain.agentrun.service.AIConnectionService;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.*;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.*;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import java.time.Instant;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class InternalCredentialServiceTest {
    private final AIConnectionService connections = mock(AIConnectionService.class);
    private final WorkspaceAuthorizationService auth = mock(WorkspaceAuthorizationService.class);
    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final AgentRunRepository runs = mock(AgentRunRepository.class);
    private final InternalCredentialService service = new InternalCredentialService(connections, auth, projects, runs);
    private final UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID(), runId = UUID.randomUUID(), credential = UUID.randomUUID();
    private final DelegationPrincipal principal = new DelegationPrincipal(user.toString(), "test", runId, workspace, project, user, Set.of("agent.run", "project.read"));

    @Test void refusesCurrentPermissionRevocationDespiteTokenPermission() {
        when(auth.authorize(user, workspace, PermissionCode.PROJECT_READ)).thenReturn(AuthorizationDecision.FORBIDDEN);
        assertThatThrownBy(() -> service.resolve(credential, Provider.OPENAI, "test-model", principal)).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(connections);
    }

    @Test void refusesChangingTheCredentialOfAnExistingRun() {
        when(auth.authorize(user, workspace, PermissionCode.PROJECT_READ)).thenReturn(AuthorizationDecision.ALLOWED);
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.of(new ProjectEntity(project, workspace, "Test", "Requirement", "KRW", null, null, null)));
        AgentRunEntity run = new AgentRunEntity(runId, workspace, project, UUID.randomUUID(), user, Provider.OPENAI, "test-model", AgentRunStatus.RUNNING, Instant.now());
        run.useCredential(UUID.randomUUID());
        when(runs.findById(runId)).thenReturn(Optional.of(run));
        assertThatThrownBy(() -> service.resolve(credential, Provider.OPENAI, "test-model", principal)).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(connections);
    }

    @Test void resolvesAuthenticatedAssumptionRequestWithoutPersistingTheKey() {
        when(auth.authorize(user, workspace, PermissionCode.PROJECT_READ)).thenReturn(AuthorizationDecision.ALLOWED);
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.of(new ProjectEntity(project, workspace, "Test", "Requirement", "KRW", null, null, null)));
        when(runs.findById(runId)).thenReturn(Optional.empty());
        when(connections.resolve(user, workspace, credential, Provider.OPENAI, "test-model")).thenReturn("synthetic-key");
        var result = service.resolve(credential, Provider.OPENAI, "test-model", principal);
        assertThat(result.apiKey()).isEqualTo("synthetic-key");
        assertThat(result.toString()).doesNotContain("synthetic-key");
        verify(runs, never()).save(any());
    }
}
