package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agenttask.dto.request.IngestAgentTaskEventRequest;
import com.freelanceops.backend.domain.agenttask.dto.response.AgentTaskEventAcknowledgement;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskAttemptEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEventEntity;
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
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
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
            .extracting(AgentTaskEventAcknowledgement::eventId).containsExactly(event.eventId());
        verify(events).saveAndFlush(any());
        assertThat(task.status()).isEqualTo(AgentTaskStatus.RUNNING);
        assertThat(attempt.status()).isEqualTo(AgentTaskAttemptStatus.RUNNING);
    }

    @Test
    void ackLossReplayReturnsSameFencedAcknowledgementWithoutProjectingAgain() {
        Instant now = Instant.parse("2026-09-02T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AgentTaskEntity taskState = new AgentTaskEntity(UUID.randomUUID(), workspaceId, runId, null,
            DepartmentName.RESEARCH, "research-v1", "Research #1", "objective:1", 3, null, now);
        int attemptNumber = taskState.dispatch(1, now);
        taskState.projectStarted(1, attemptNumber, now.plusSeconds(1));
        AgentTaskAttemptEntity attemptState = new AgentTaskAttemptEntity(UUID.randomUUID(), workspaceId,
            taskState.id(), 1, attemptNumber, null, null, null, now);
        attemptState.projectStarted(now.plusSeconds(1));
        AgentTaskEntity task = spy(taskState);
        AgentTaskAttemptEntity attempt = spy(attemptState);
        IngestAgentTaskEventRequest event = event("attempt.completed", task, attempt, workspaceId, runId,
            now.plusSeconds(2));
        AgentTaskEventEntity stored = stored(event, now.plusSeconds(3));
        when(tasks.findByIdAndWorkspaceIdForUpdate(task.id(), workspaceId)).thenReturn(Optional.of(task));
        when(attempts.findByIdAndWorkspaceIdForUpdate(attempt.id(), workspaceId)).thenReturn(Optional.of(attempt));
        when(events.findConflicts(event.eventId(), event.source(), event.sourceEventId(), event.attemptId(), event.sequence()))
            .thenReturn(List.of(), List.of(stored));

        List<AgentTaskEventAcknowledgement> first = service.ingest(List.of(event), workspaceId, runId,
            now.plusSeconds(3));
        List<AgentTaskEventAcknowledgement> replay = service.ingest(List.of(event), workspaceId, runId,
            now.plusSeconds(4));

        assertThat(replay).isEqualTo(first);
        assertThat(first.getFirst().workspaceId()).isEqualTo(workspaceId);
        assertThat(first.getFirst().taskRevision()).isEqualTo(1);
        verify(events, times(1)).saveAndFlush(any());
        verify(attempt, times(1)).projectTerminal(AgentTaskAttemptStatus.COMPLETED, null, event.occurredAt());
        verify(task, times(1)).complete(1, attemptNumber, AgentTaskStatus.COMPLETED, now.plusSeconds(3));
    }

    @Test
    void finalFailureEventTerminatesCurrentTaskProjection() {
        Instant now = Instant.parse("2026-09-02T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AgentTaskEntity task = new AgentTaskEntity(UUID.randomUUID(), workspaceId, runId, null,
            DepartmentName.RESEARCH, "research-v1", "Research #1", "objective:1", 3, null, now);
        int attemptNumber = task.dispatch(1, now);
        task.projectStarted(1, attemptNumber, now.plusSeconds(1));
        AgentTaskAttemptEntity attempt = new AgentTaskAttemptEntity(UUID.randomUUID(), workspaceId, task.id(), 1,
            attemptNumber, null, null, null, now);
        attempt.projectStarted(now.plusSeconds(1));
        IngestAgentTaskEventRequest event = event("attempt.failed", task, attempt, workspaceId, runId,
            now.plusSeconds(2), Map.of("failure_code", "PROVIDER_TIMEOUT", "task_terminal", true));
        when(tasks.findByIdAndWorkspaceIdForUpdate(task.id(), workspaceId)).thenReturn(Optional.of(task));
        when(attempts.findByIdAndWorkspaceIdForUpdate(attempt.id(), workspaceId)).thenReturn(Optional.of(attempt));
        when(events.findConflicts(event.eventId(), event.source(), event.sourceEventId(), event.attemptId(), event.sequence()))
            .thenReturn(List.of());

        service.ingest(List.of(event), workspaceId, runId, now.plusSeconds(3));

        assertThat(attempt.status()).isEqualTo(AgentTaskAttemptStatus.FAILED);
        assertThat(task.status()).isEqualTo(AgentTaskStatus.FAILED);
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

    @Test
    void retryDecisionProjectsStructuredClassificationAndRetryWait() {
        Instant now = Instant.parse("2026-09-01T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        AgentTaskEntity task = new AgentTaskEntity(UUID.randomUUID(), workspaceId, runId, null,
            DepartmentName.RESEARCH, "research-v1", "Research #1", "objective:1", 3, null, now);
        int attemptNumber = task.dispatch(1, now);
        AgentTaskAttemptEntity attempt = new AgentTaskAttemptEntity(UUID.randomUUID(), workspaceId, task.id(), 1,
            attemptNumber, null, null, null, now);
        attempt.projectStarted(now.plusSeconds(1));
        task.projectStarted(1, attemptNumber, now.plusSeconds(1));
        attempt.projectTerminal(AgentTaskAttemptStatus.FAILED, "PROVIDER_TIMEOUT", now.plusSeconds(2));
        Map<String, Object> data = Map.ofEntries(Map.entry("decision", "ALLOW"),
            Map.entry("reason", "RETRY_ALLOWED"), Map.entry("failure_classification", "INDEPENDENT_TRANSIENT"),
            Map.entry("classification_confidence", 0.79),
            Map.entry("classifier_version", "weighted-multi-signal-v1"),
            Map.entry("bucket_policy_version", "hierarchical-count-v1"),
            Map.entry("workspace_tokens_before", 12.0), Map.entry("workspace_tokens_after", 11.0),
            Map.entry("global_tokens_before", 16.0), Map.entry("global_tokens_after", 15.0),
            Map.entry("retry_ready_at", "2026-09-01T00:00:05Z"));
        IngestAgentTaskEventRequest event = event("attempt.retry_decided", task, attempt, workspaceId, runId,
            now.plusSeconds(3), data);
        when(tasks.findByIdAndWorkspaceIdForUpdate(task.id(), workspaceId)).thenReturn(Optional.of(task));
        when(attempts.findByIdAndWorkspaceIdForUpdate(attempt.id(), workspaceId)).thenReturn(Optional.of(attempt));
        when(events.findConflicts(event.eventId(), event.source(), event.sourceEventId(), event.attemptId(), event.sequence()))
            .thenReturn(List.of());

        service.ingest(List.of(event), workspaceId, runId, now.plusSeconds(4));

        assertThat(task.status()).isEqualTo(AgentTaskStatus.RETRY_WAIT);
        assertThat(task.activity()).isEqualTo("RETRY_ALLOWED");
        assertThat(attempt.failureClassification()).isEqualTo("INDEPENDENT_TRANSIENT");
        assertThat(attempt.retryDecision()).isEqualTo("ALLOW");
        assertThat(attempt.retryReadyAt()).isEqualTo(Instant.parse("2026-09-01T00:00:05Z"));
    }

    private static IngestAgentTaskEventRequest event(String type, AgentTaskEntity task,
                                                       AgentTaskAttemptEntity attempt, UUID workspaceId,
                                                       UUID runId, Instant occurredAt) {
        return event(type, task, attempt, workspaceId, runId, occurredAt, Map.of());
    }

    private static IngestAgentTaskEventRequest event(String type, AgentTaskEntity task,
                                                       AgentTaskAttemptEntity attempt, UUID workspaceId,
                                                       UUID runId, Instant occurredAt, Map<String, Object> data) {
        return new IngestAgentTaskEventRequest("event-1", runId, workspaceId, task.id(), attempt.taskRevision(),
            attempt.id(), attempt.attemptNumber(), "task-attempt-telemetry-v1", "worker", "source-1", 1,
            type, "research", "collecting sources", data, occurredAt);
    }

    private static AgentTaskEventEntity stored(IngestAgentTaskEventRequest event, Instant receivedAt) {
        return new AgentTaskEventEntity(event.eventId(), event.workspaceId(), event.runId(), event.taskId(),
            event.taskRevision(), event.attemptId(), event.attemptNumber(), event.schemaVersion(), event.source(),
            event.sourceEventId(), event.sequence(), event.eventType(), event.phase(), event.milestone(), event.data(),
            event.occurredAt(), receivedAt);
    }
}
