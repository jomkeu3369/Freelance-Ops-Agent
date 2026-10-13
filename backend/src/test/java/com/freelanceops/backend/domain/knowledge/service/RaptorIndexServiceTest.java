package com.freelanceops.backend.domain.knowledge.service;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.knowledge.client.RaptorBuildClient;
import com.freelanceops.backend.domain.knowledge.client.dto.response.RaptorBuildResponse;
import com.freelanceops.backend.domain.knowledge.dto.request.CreateRaptorIndexRequest;
import com.freelanceops.backend.domain.knowledge.entity.DocumentChunkEntity;
import com.freelanceops.backend.domain.knowledge.entity.RaptorActiveSnapshotEntity;
import com.freelanceops.backend.domain.knowledge.entity.RaptorIndexSnapshotEntity;
import com.freelanceops.backend.domain.knowledge.repository.*;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.*;
import com.freelanceops.backend.domain.workspace.repository.WorkspaceRepository;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.lang.reflect.Method;
import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class RaptorIndexServiceTest {
    @Test
    void manualIndexingFailsClosedBeforeAnyPaidCallOrSnapshot() {
        WorkspacePermissionReader permissionReader = mock(WorkspacePermissionReader.class);
        ProjectRepository projectRepository = mock(ProjectRepository.class);
        DelegationTokenIssuer tokenIssuer = mock(DelegationTokenIssuer.class);
        RaptorBuildClient client = mock(RaptorBuildClient.class);
        RaptorIndexTransactions transactions = mock(RaptorIndexTransactions.class);
        UUID userId = UUID.randomUUID(), workspaceId = UUID.randomUUID(), projectId = UUID.randomUUID();
        when(permissionReader.findActiveMembership(userId, workspaceId)).thenReturn(Optional.of(
            new MembershipPermissions(UUID.randomUUID(), Set.of(PermissionCode.DOCUMENT_WRITE, PermissionCode.AGENT_RUN))));
        when(projectRepository.findByIdAndWorkspaceId(projectId, workspaceId)).thenReturn(Optional.of(mock(ProjectEntity.class)));
        RaptorIndexService service = new RaptorIndexService(permissionReader, projectRepository);
        assertThatThrownBy(() -> service.rebuild(userId, workspaceId, projectId,
            new CreateRaptorIndexRequest(Provider.OPENAI, "embedding", "summary", 4, 4, 20), "trace"))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> {
                assertThat(error.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
                assertThat(error.getReason()).contains("RAPTOR_COST_CONTROL_UNSUPPORTED");
            });
        verifyNoInteractions(tokenIssuer, client, transactions);
    }

    @Test
    void blockedIndexingStillHidesOtherTenantsAndEnforcesPermissions() {
        WorkspacePermissionReader permissions = mock(WorkspacePermissionReader.class);
        ProjectRepository projects = mock(ProjectRepository.class);
        RaptorBuildClient client = mock(RaptorBuildClient.class);
        RaptorIndexService service = new RaptorIndexService(permissions, projects);
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
        var request = new CreateRaptorIndexRequest(Provider.OPENAI, "embedding", "summary", 4, 4, 20);
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.rebuild(user, workspace, project, request, "trace"))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(), Set.of(PermissionCode.DOCUMENT_READ))));
        assertThatThrownBy(() -> service.rebuild(user, workspace, project, request, "trace"))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));
        verifyNoInteractions(projects, client);
    }

    @Test
    void transactionBoundariesAreExplicitAndCoordinatorIsNotTransactional() throws Exception {
        assertThat(RaptorIndexService.class.getMethod("rebuild", UUID.class, UUID.class, UUID.class, CreateRaptorIndexRequest.class, String.class).getAnnotation(Transactional.class)).isNull();
        assertRequiresNew("begin", UUID.class, UUID.class, UUID.class, String.class, String.class);
        assertRequiresNew("publish", RaptorIndexTransactions.PreparedBuild.class, RaptorBuildResponse.class);
        assertRequiresNew("fail", UUID.class, UUID.class, String.class);
        assertThat(RaptorIndexTransactions.class.getMethod("invalidateActiveSnapshot", UUID.class).getAnnotation(Transactional.class).propagation()).isEqualTo(Propagation.REQUIRED);
    }

    @Test
    void rejectsOversizedSourcesBeforeCreatingSnapshot() {
        DocumentChunkRepository chunkRepository = mock(DocumentChunkRepository.class);
        RaptorIndexSnapshotRepository snapshotRepository = mock(RaptorIndexSnapshotRepository.class);
        RaptorIndexTransactions transactions = new RaptorIndexTransactions(mock(WorkspaceRepository.class), chunkRepository, snapshotRepository, mock(RaptorNodeRepository.class), mock(RaptorActiveSnapshotRepository.class));
        when(chunkRepository.findAllActiveByWorkspaceId(any())).thenReturn(Collections.nCopies(501, mock(DocumentChunkEntity.class)));

        assertThatThrownBy(() -> transactions.begin(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "embedding", "summary"))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY));
        verify(snapshotRepository, never()).save(any());
    }

    @Test
    void invalidationUsesWorkspaceLockAndRemovesActivePointer() {
        WorkspaceRepository workspaceRepository = mock(WorkspaceRepository.class);
        DocumentChunkRepository chunkRepository = mock(DocumentChunkRepository.class);
        RaptorIndexSnapshotRepository snapshotRepository = mock(RaptorIndexSnapshotRepository.class);
        RaptorActiveSnapshotRepository activeSnapshotRepository = mock(RaptorActiveSnapshotRepository.class);
        RaptorIndexTransactions transactions = new RaptorIndexTransactions(workspaceRepository, chunkRepository, snapshotRepository, mock(RaptorNodeRepository.class), activeSnapshotRepository);
        UUID workspaceId = UUID.randomUUID(); UUID snapshotId = UUID.randomUUID();
        RaptorActiveSnapshotEntity active = mock(RaptorActiveSnapshotEntity.class);
        RaptorIndexSnapshotEntity snapshot = mock(RaptorIndexSnapshotEntity.class);
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(mock(com.freelanceops.backend.domain.workspace.entity.WorkspaceEntity.class)));
        when(activeSnapshotRepository.findById(workspaceId)).thenReturn(Optional.of(active));
        when(active.snapshotId()).thenReturn(snapshotId);
        when(snapshotRepository.findForUpdate(workspaceId, snapshotId)).thenReturn(Optional.of(snapshot));

        transactions.invalidateActiveSnapshot(workspaceId);

        InOrder order = inOrder(workspaceRepository, snapshot, activeSnapshotRepository);
        order.verify(workspaceRepository).findByIdForUpdate(workspaceId);
        order.verify(snapshot).supersede();
        order.verify(activeSnapshotRepository).delete(active);
        order.verify(activeSnapshotRepository).flush();
    }

    private static void assertRequiresNew(String name, Class<?>... parameters) throws Exception {
        Method method = RaptorIndexTransactions.class.getMethod(name, parameters);
        assertThat(method.getAnnotation(Transactional.class).propagation()).isEqualTo(Propagation.REQUIRES_NEW);
    }
}
