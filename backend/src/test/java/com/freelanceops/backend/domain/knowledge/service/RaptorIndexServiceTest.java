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
    void callsAgentOutsideDatabaseTransactionsThenPublishesAtomically() {
        WorkspacePermissionReader permissionReader = mock(WorkspacePermissionReader.class);
        ProjectRepository projectRepository = mock(ProjectRepository.class);
        DelegationTokenIssuer tokenIssuer = mock(DelegationTokenIssuer.class);
        RaptorBuildClient client = mock(RaptorBuildClient.class);
        RaptorIndexTransactions transactions = mock(RaptorIndexTransactions.class);
        UUID userId = UUID.randomUUID(); UUID workspaceId = UUID.randomUUID(); UUID projectId = UUID.randomUUID();
        RaptorIndexTransactions.PreparedBuild prepared = new RaptorIndexTransactions.PreparedBuild(UUID.randomUUID(), workspaceId, "fingerprint", List.of(new RaptorIndexTransactions.SourceChunk(UUID.randomUUID(), UUID.randomUUID(), "source", Map.of())));
        RaptorBuildResponse response = new RaptorBuildResponse(workspaceId, prepared.snapshotId(), "embedding", "summary", List.of(), List.of());

        when(permissionReader.findActiveMembership(userId, workspaceId)).thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(), Set.of(PermissionCode.DOCUMENT_WRITE, PermissionCode.AGENT_RUN))));
        when(projectRepository.findByIdAndWorkspaceId(projectId, workspaceId)).thenReturn(Optional.of(mock(ProjectEntity.class)));
        when(transactions.begin(any(), eq(workspaceId), eq(userId), eq("embedding"), eq("summary"))).thenReturn(prepared);
        when(tokenIssuer.issue(any(), eq(workspaceId), eq(projectId), eq(userId), anyList())).thenReturn("token");
        when(client.build(any(), eq("token"), eq("trace"))).thenReturn(response);
        when(transactions.publish(prepared, response)).thenReturn(3);

        RaptorIndexService service = new RaptorIndexService(permissionReader, projectRepository, tokenIssuer, client, transactions);
        var result = service.rebuild(userId, workspaceId, projectId, new CreateRaptorIndexRequest(Provider.OPENAI, "embedding", "summary", 4, 4, 20), "trace");

        assertThat(result.status()).isEqualTo("PUBLISHED"); assertThat(result.nodeCount()).isEqualTo(3);
        InOrder order = inOrder(transactions, client); order.verify(transactions).begin(any(), eq(workspaceId), eq(userId), eq("embedding"), eq("summary")); order.verify(client).build(any(), eq("token"), eq("trace")); order.verify(transactions).publish(prepared, response);
        verify(transactions, never()).fail(any(), any(), any());
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
