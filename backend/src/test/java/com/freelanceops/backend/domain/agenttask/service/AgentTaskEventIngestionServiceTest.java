package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agenttask.dto.request.IngestAgentTaskEventRequest;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskAttemptEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskAttemptStatus;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskStatus;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskAttemptRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskEventRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskRepository;
import com.freelanceops.backend.domain.agentrun.model.DepartmentName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AgentTaskEventIngestionServiceTest {

    private final AgentTaskRepository tasks = mock(AgentTaskRepository.class);
    private final AgentTaskAttemptRepository attempts = mock(AgentTaskAttemptRepository.class);
    private final AgentTaskEventRepository events = mock(AgentTaskEventRepository.class);
    private final AgentTaskEventIngestionService service = new AgentTaskEventIngestionService(tasks, attempts, events);

    @Test
    void startedEventIsPersistedBeforeProjectingCurrentAttempt() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AgentTaskEntity task = new AgentTaskEntity(UUID.randomUUID(), workspaceId, runId, null,
            DepartmentName.RESEARCH, "research-v1", "Research #1", "objective:1", 3, null, now);
        int attemptNumber = task.dispatch(1, now);
        AgentTaskAttemptEntity attempt = new AgentTaskAttemptEntity(UUID.randomUUID(), workspaceId, task.id(), 1,
            attemptNumber, null, null, null, now);
        IngestAgentTaskEventRequest event = event("attempt.started", task, attempt, workspaceId, runId, now.plusSeconds(1));
        when(tasks.findByIdAndWorkspaceIdForUpdate(task.id(), workspaceId)).thenReturn(Optional.of(task));
        when(attempts.findByIdAndWorkspaceIdForUpdate(attempt.id(), workspaceId)).thenReturn(Optional.of(attempt));
        when(events.findConflicts(event.eventId(), event.source(), event.sourceEventId(), event.attemptId(), event.sequence()))
            .thenReturn(List.of());

        assertThat(service.ingest(List.of(event), workspaceId, runId, now.plusSeconds(2)))
            .containsExactly(event.eventId());
        verify(events).saveAndFlush(any());
        assertThat(task.status()).isEqualTo(AgentTaskStatus.RUNNING);
        assertThat(attempt.status()).isEqualTo(AgentTaskAttemptStatus.RUNNING);
    }

    @Test
    void eventFromSupersededRevisionRemainsAuditableWithoutChangingProjection() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AgentTaskEntity task = new AgentTaskEntity(UUID.randomUUID(), workspaceId, runId, null,
            DepartmentName.RESEARCH, "research-v1", "Research #1", "objective:1", 3, null, now);
        int attemptNumber = task.dispatch(1, now);
        AgentTaskAttemptEntity attempt = new AgentTaskAttemptEntity(UUID.randomUUID(), workspaceId, task.id(), 1,
            attemptNumber, null, null, null, now);
        task.redirect(1, now.plusSeconds(1));
        IngestAgentTaskEventRequest event = event("attempt.started", task, attempt, workspaceId, runId, now.plusSeconds(2));
        when(tasks.findByIdAndWorkspaceIdForUpdate(task.id(), workspaceId)).thenReturn(Optional.of(task));
        when(attempts.findByIdAndWorkspaceIdForUpdate(attempt.id(), workspaceId)).thenReturn(Optional.of(attempt));
        when(events.findConflicts(event.eventId(), event.source(), event.sourceEventId(), event.attemptId(), event.sequence()))
            .thenReturn(List.of());

        service.ingest(List.of(event), workspaceId, runId, now.plusSeconds(3));

        assertThat(task.status()).isEqualTo(AgentTaskStatus.QUEUED);
        assertThat(task.revision()).isEqualTo(2);
        assertThat(attempt.status()).isEqualTo(AgentTaskAttemptStatus.QUEUED);
    }

    private static IngestAgentTaskEventRequest event(String type, AgentTaskEntity task,
                                                       AgentTaskAttemptEntity attempt, UUID workspaceId,
                                                       UUID runId, Instant occurredAt) {
        return new IngestAgentTaskEventRequest("event-1", runId, workspaceId, task.id(), attempt.taskRevision(),
            attempt.id(), attempt.attemptNumber(), "task-attempt-telemetry-v1", "worker", "source-1", 1,
            type, "research", "collecting sources", Map.of(), occurredAt);
    }
}
