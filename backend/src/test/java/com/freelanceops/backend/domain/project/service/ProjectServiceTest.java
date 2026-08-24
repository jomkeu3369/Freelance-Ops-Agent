package com.freelanceops.backend.domain.project.service;

import com.freelanceops.backend.domain.client.repository.ClientRepository;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ProjectServiceTest {

    @Mock
    private ProjectRepository projectRepository;
    @Mock
    private ClientRepository clientRepository;
    @Mock
    private WorkspaceAuthorizationService authorizationService;
    @Mock
    private ProjectAgentRunCleanup agentRunCleanup;
    @Mock
    private ProjectDeletionTransaction deletionTransaction;

    @Test
    void listSearchesProjectAndClientNamesWithinWorkspace() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.PROJECT_READ))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(projectRepository.searchByWorkspaceId(workspaceId, "%고객 포털%"))
            .thenReturn(List.of());
        ProjectService service = service();

        assertThat(service.list(userId, workspaceId, "  고객 포털  ")).isEmpty();

        verify(projectRepository).searchByWorkspaceId(workspaceId, "%고객 포털%");
        verify(projectRepository, never()).findAllByWorkspaceIdOrderByUpdatedAtDesc(workspaceId);
    }

    @Test
    void blankSearchUsesUpdatedProjectList() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.PROJECT_READ))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(projectRepository.findAllByWorkspaceIdOrderByUpdatedAtDesc(workspaceId))
            .thenReturn(List.of());
        ProjectService service = service();

        assertThat(service.list(userId, workspaceId, "   ")).isEmpty();

        verify(projectRepository).findAllByWorkspaceIdOrderByUpdatedAtDesc(workspaceId);
        verify(projectRepository, never()).searchByWorkspaceId(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void deleteUsesDedicatedPermissionAndWorkspaceScopedLookup() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.PROJECT_DELETE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        ProjectService service = service();

        service.delete(userId, workspaceId, projectId, "traceparent");

        verify(deletionTransaction).begin(workspaceId, projectId);
        verify(agentRunCleanup).cancelActiveRuns(userId, workspaceId, projectId, "traceparent");
        verify(deletionTransaction).finish(workspaceId, projectId);
    }

    @Test
    void forbiddenDeleteStopsBeforeProjectLookup() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.PROJECT_DELETE))
            .thenReturn(AuthorizationDecision.FORBIDDEN);
        ProjectService service = service();

        assertThatThrownBy(() -> service.delete(userId, workspaceId, UUID.randomUUID(), "traceparent"))
            .isInstanceOfSatisfying(ResponseStatusException.class, error ->
                assertThat(error.getStatusCode().value()).isEqualTo(403));
        verify(deletionTransaction, never()).begin(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void deleteStopsBeforeRemovingTheProjectWhenAgentCleanupFails() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.PROJECT_DELETE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        doThrow(new IllegalStateException("agent unavailable"))
            .when(agentRunCleanup).cancelActiveRuns(userId, workspaceId, projectId, "traceparent");

        assertThatThrownBy(() -> service().delete(userId, workspaceId, projectId, "traceparent"))
            .isInstanceOf(IllegalStateException.class);

        verify(deletionTransaction).begin(workspaceId, projectId);
        verify(deletionTransaction, never()).finish(any(), any());
    }

    private ProjectService service() {
        return new ProjectService(projectRepository, clientRepository, authorizationService, agentRunCleanup, deletionTransaction);
    }

}
