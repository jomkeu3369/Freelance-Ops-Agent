package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskAttemptEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskAttemptRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskDependencyRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskRepository;
import com.freelanceops.backend.domain.agentrun.model.DepartmentName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AgentTaskRegistryTest {

    private final AgentTaskRepository taskRepository = mock(AgentTaskRepository.class);
    private final AgentTaskAttemptRepository attemptRepository = mock(AgentTaskAttemptRepository.class);
    private final AgentTaskDependencyRepository dependencyRepository = mock(AgentTaskDependencyRepository.class);
    private final AgentTaskRegistry registry = new AgentTaskRegistry(taskRepository, attemptRepository, dependencyRepository);

    @Test
    void rejectsDependencyFromAnotherWorkspaceBeforeSaving() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        UUID dependencyId = UUID.randomUUID();
        AgentTaskEntity task = task(workspaceId, UUID.randomUUID(), now);
        when(taskRepository.findByIdAndWorkspaceIdForUpdate(task.id(), workspaceId)).thenReturn(Optional.empty());
        when(taskRepository.findByIdAndWorkspaceId(dependencyId, workspaceId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> registry.register(task, List.of(dependencyId), now))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("workspace");

        verify(taskRepository, never()).saveAndFlush(task);
        verify(dependencyRepository, never()).saveAll(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void exactRegistrationRetryReturnsExistingTaskWithoutWriting() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        AgentTaskEntity task = task(workspaceId, UUID.randomUUID(), now);
        when(taskRepository.findByIdAndWorkspaceIdForUpdate(task.id(), workspaceId)).thenReturn(Optional.of(task));
        when(dependencyRepository.findAllByTaskId(task.id())).thenReturn(List.of());

        AgentTaskEntity registered = registry.register(task, List.of(), now.plusSeconds(1));

        assertThat(registered).isSameAs(task);
        var order = inOrder(taskRepository);
        order.verify(taskRepository).lockRegistration(task.id());
        order.verify(taskRepository).findByIdAndWorkspaceIdForUpdate(task.id(), workspaceId);
        verify(taskRepository, never()).saveAndFlush(task);
        verify(dependencyRepository, never()).saveAll(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void registrationRetryRejectsDifferentContract() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AgentTaskEntity existing = task(workspaceId, runId, now);
        AgentTaskEntity conflicting = new AgentTaskEntity(existing.id(), workspaceId, runId, null,
            DepartmentName.RESEARCH, "research-v1", "Different alias", "objective:1", 3, null, now);
        when(taskRepository.findByIdAndWorkspaceIdForUpdate(existing.id(), workspaceId))
            .thenReturn(Optional.of(existing));
        when(dependencyRepository.findAllByTaskId(existing.id())).thenReturn(List.of());

        assertThatThrownBy(() -> registry.register(conflicting, List.of(), now.plusSeconds(1)))
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("idempotency");
    }

    @Test
    void exactAttemptRetryReturnsExistingAttemptWithoutDispatchingAgain() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        AgentTaskEntity task = task(workspaceId, UUID.randomUUID(), now);
        int attemptNumber = task.dispatch(1, now);
        UUID attemptId = UUID.randomUUID();
        AgentTaskAttemptEntity existing = new AgentTaskAttemptEntity(attemptId, workspaceId, task.id(), 1,
            attemptNumber, 12.0, "baseline-v1", Map.of("profile", "research-read-v1"), now);
        when(attemptRepository.findByIdAndWorkspaceIdForUpdate(attemptId, workspaceId))
            .thenReturn(Optional.of(existing));

        AgentTaskAttemptEntity registered = registry.createAttempt(task.id(), workspaceId, 1, attemptId, 12.0,
            "baseline-v1", Map.of("profile", "research-read-v1"), now.plusSeconds(1));

        assertThat(registered).isSameAs(existing);
        assertThat(task.currentAttemptNumber()).isEqualTo(1);
        verify(attemptRepository, never()).saveAndFlush(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void attemptRetryRejectsDifferentPredictionContract() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        AgentTaskEntity task = task(workspaceId, UUID.randomUUID(), now);
        int attemptNumber = task.dispatch(1, now);
        UUID attemptId = UUID.randomUUID();
        AgentTaskAttemptEntity existing = new AgentTaskAttemptEntity(attemptId, workspaceId, task.id(), 1,
            attemptNumber, 12.0, "baseline-v1", Map.of(), now);
        when(attemptRepository.findByIdAndWorkspaceIdForUpdate(attemptId, workspaceId))
            .thenReturn(Optional.of(existing));

        assertThatThrownBy(() -> registry.createAttempt(task.id(), workspaceId, 1, attemptId, 15.0,
            "baseline-v1", Map.of(), now.plusSeconds(1)))
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("idempotency");
    }

    @Test
    void hardRedirectSupersedesCurrentAttemptBeforeRevisionChanges() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        AgentTaskEntity task = task(workspaceId, UUID.randomUUID(), now);
        int attemptNumber = task.dispatch(1, now);
        AgentTaskAttemptEntity attempt = new AgentTaskAttemptEntity(UUID.randomUUID(), workspaceId, task.id(), 1,
            attemptNumber, null, null, null, now);
        when(taskRepository.findByIdAndWorkspaceIdForUpdate(task.id(), workspaceId)).thenReturn(Optional.of(task));
        when(attemptRepository.findCurrentForUpdate(task.id(), 1, attemptNumber)).thenReturn(Optional.of(attempt));

        registry.hardRedirect(task.id(), workspaceId, 1, now.plusSeconds(1));

        org.assertj.core.api.Assertions.assertThat(task.revision()).isEqualTo(2);
        org.assertj.core.api.Assertions.assertThat(attempt.status().name()).isEqualTo("SUPERSEDED");
    }

    private static AgentTaskEntity task(UUID workspaceId, UUID runId, Instant now) {
        return new AgentTaskEntity(UUID.randomUUID(), workspaceId, runId, null, DepartmentName.RESEARCH,
            "research-v1", "Research #1", "objective:1", 3, null, now);
    }

    @Test
    void rejectsParentFromAnotherRun() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        AgentTaskEntity parent = task(workspaceId, UUID.randomUUID(), now);
        AgentTaskEntity child = new AgentTaskEntity(UUID.randomUUID(), workspaceId, UUID.randomUUID(), parent.id(),
            DepartmentName.RESEARCH, "research-v1", "Child", "objective:1", 3, null, now);
        when(taskRepository.findByIdAndWorkspaceId(parent.id(), workspaceId)).thenReturn(Optional.of(parent));

        assertThatThrownBy(() -> registry.register(child, List.of(), now))
            .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("same run");
        verify(taskRepository, never()).saveAndFlush(child);
    }

    @Test
    void rejectsOriginalRegistrationAfterRedirect() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        AgentTaskEntity original = task(UUID.randomUUID(), UUID.randomUUID(), now);
        AgentTaskEntity current = new AgentTaskEntity(original.id(), original.workspaceId(), original.runId(), null,
            DepartmentName.RESEARCH, "research-v1", "Research #1", "objective:1", 3, null, now);
        current.redirect(1, now.plusSeconds(1));
        when(taskRepository.findByIdAndWorkspaceIdForUpdate(original.id(), original.workspaceId()))
            .thenReturn(Optional.of(current));

        assertThatThrownBy(() -> registry.register(original, List.of(), now.plusSeconds(2)))
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("idempotency");
    }
}
