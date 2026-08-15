package com.freelanceops.backend.domain.project.service;

import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.client.repository.ClientRepository;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
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
    private AgentRunRepository agentRunRepository;
    @Mock
    private WorkspaceAuthorizationService authorizationService;

    @Test
    void deleteUsesDedicatedPermissionAndWorkspaceScopedLookup() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        ProjectEntity project = mock(ProjectEntity.class);
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.PROJECT_DELETE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(projectRepository.findByIdAndWorkspaceId(projectId, workspaceId)).thenReturn(Optional.of(project));
        ProjectService service = new ProjectService(projectRepository, clientRepository, agentRunRepository, authorizationService);

        service.delete(userId, workspaceId, projectId);

        verify(projectRepository).findByIdAndWorkspaceId(projectId, workspaceId);
        verify(projectRepository).delete(project);
    }

    @Test
    void forbiddenDeleteStopsBeforeProjectLookup() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.PROJECT_DELETE))
            .thenReturn(AuthorizationDecision.FORBIDDEN);
        ProjectService service = new ProjectService(projectRepository, clientRepository, agentRunRepository, authorizationService);

        assertThatThrownBy(() -> service.delete(userId, workspaceId, UUID.randomUUID()))
            .isInstanceOfSatisfying(ResponseStatusException.class, error ->
                assertThat(error.getStatusCode().value()).isEqualTo(403));
        verify(projectRepository, never()).findByIdAndWorkspaceId(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
        verify(projectRepository, never()).delete(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void activeAgentRunMustBeStoppedBeforeDelete() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.PROJECT_DELETE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(projectRepository.findByIdAndWorkspaceId(projectId, workspaceId)).thenReturn(Optional.of(mock(ProjectEntity.class)));
        when(agentRunRepository.existsByWorkspaceIdAndProjectIdAndStatusIn(
            org.mockito.ArgumentMatchers.eq(workspaceId),
            org.mockito.ArgumentMatchers.eq(projectId),
            org.mockito.ArgumentMatchers.any()
        )).thenReturn(true);
        ProjectService service = new ProjectService(projectRepository, clientRepository, agentRunRepository, authorizationService);

        assertThatThrownBy(() -> service.delete(userId, workspaceId, projectId))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> {
                assertThat(error.getStatusCode().value()).isEqualTo(409);
                assertThat(error.getReason()).contains("AI 분석을 중단");
            });
        verify(projectRepository, never()).delete(org.mockito.ArgumentMatchers.any());
    }
}
