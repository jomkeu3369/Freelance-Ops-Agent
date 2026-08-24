package com.freelanceops.backend.domain.project.service;

import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.model.ProjectDeletionInProgressException;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProjectDeletionTransactionTest {

    @Test
    void doesNotDeleteWhileAnAgentCommandStillOwnsAValidLease() {
        ProjectRepository repository = mock(ProjectRepository.class);
        ProjectAgentCommandFence fence = mock(ProjectAgentCommandFence.class);
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        ProjectEntity project = new ProjectEntity(
            projectId, workspaceId, "프로젝트", "요구사항", "KRW", null, null, null
        );
        project.requestDeletion(Instant.now());
        when(repository.findByIdAndWorkspaceIdForUpdate(projectId, workspaceId)).thenReturn(Optional.of(project));
        doThrow(new ProjectDeletionInProgressException())
            .when(fence).requireNoInFlightCommands(workspaceId, projectId);

        assertThatThrownBy(() -> new ProjectDeletionTransaction(repository, fence).finish(workspaceId, projectId))
            .isInstanceOf(ProjectDeletionInProgressException.class);

        verify(repository, never()).delete(project);
    }
}
