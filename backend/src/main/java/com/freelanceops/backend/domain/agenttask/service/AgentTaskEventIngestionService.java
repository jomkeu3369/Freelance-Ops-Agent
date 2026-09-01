package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agenttask.dto.request.IngestAgentTaskEventRequest;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskAttemptEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEventEntity;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskAttemptStatus;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskStatus;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskAttemptRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskEventRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class AgentTaskEventIngestionService {

    private static final String SCHEMA_VERSION = "task-attempt-telemetry-v1";
    private static final Set<String> EVENT_TYPES = Set.of("attempt.predicted", "attempt.queued", "attempt.started",
        "attempt.checkpointed", "attempt.update_applied", "attempt.cancelled", "attempt.failed",
        "attempt.retry_decided", "attempt.completed", "attempt.incident_finalized");
    private static final Set<String> FORBIDDEN_KEYS = Set.of("api_key", "chain_of_thought", "delegation_token",
        "prompt", "resume_token", "secret");
    private final AgentTaskRepository taskRepository;
    private final AgentTaskAttemptRepository attemptRepository;
    private final AgentTaskEventRepository eventRepository;

    public AgentTaskEventIngestionService(AgentTaskRepository taskRepository,
                                          AgentTaskAttemptRepository attemptRepository,
                                          AgentTaskEventRepository eventRepository) {
        this.taskRepository = taskRepository;
        this.attemptRepository = attemptRepository;
        this.eventRepository = eventRepository;
    }

    @Transactional
    public List<String> ingest(List<IngestAgentTaskEventRequest> requests, java.util.UUID principalWorkspaceId,
                               java.util.UUID principalRunId, Instant receivedAt) {
        return requests.stream().map(request -> ingestOne(request, principalWorkspaceId, principalRunId, receivedAt)).toList();
    }

    private String ingestOne(IngestAgentTaskEventRequest request, java.util.UUID principalWorkspaceId,
                             java.util.UUID principalRunId, Instant receivedAt) {
        validate(request, principalWorkspaceId, principalRunId);
        AgentTaskEntity task = taskRepository.findByIdAndWorkspaceIdForUpdate(request.taskId(), request.workspaceId())
            .orElseThrow(() -> new IllegalArgumentException("task event target was not found in workspace"));
        if (!task.runId().equals(request.runId())) throw new IllegalArgumentException("task event run does not match task");
        AgentTaskAttemptEntity attempt = attemptRepository.findByIdAndWorkspaceIdForUpdate(request.attemptId(), request.workspaceId())
            .orElseThrow(() -> new IllegalArgumentException("task event attempt was not found in workspace"));
        if (!attempt.taskId().equals(request.taskId()) || attempt.taskRevision() != request.taskRevision()
            || attempt.attemptNumber() != request.attemptNumber()) {
            throw new IllegalArgumentException("task event attempt identity is invalid");
        }
        AgentTaskEventEntity incoming = entity(request, receivedAt);
        List<AgentTaskEventEntity> conflicts = eventRepository.findConflicts(request.eventId(), request.source(),
            request.sourceEventId(), request.attemptId(), request.sequence());
        if (!conflicts.isEmpty()) {
            if (conflicts.stream().allMatch(existing -> sameIdentity(existing, incoming))) return conflicts.getFirst().eventId();
            throw new IllegalStateException("task event idempotency key conflicts with different data");
        }
        eventRepository.saveAndFlush(incoming);
        project(request, task, attempt, receivedAt);
        return incoming.eventId();
    }

    private static void project(IngestAgentTaskEventRequest event, AgentTaskEntity task,
                                AgentTaskAttemptEntity attempt, Instant receivedAt) {
        if (task.revision() != event.taskRevision() || task.currentAttemptNumber() != event.attemptNumber()) return;
        switch (event.eventType()) {
            case "attempt.started" -> {
                attempt.projectStarted(event.occurredAt());
                task.projectStarted(event.taskRevision(), event.attemptNumber(), receivedAt);
            }
            case "attempt.checkpointed" -> attempt.projectCheckpointed(event.data(), event.occurredAt());
            case "attempt.update_applied" -> {
                attempt.projectUpdateApplied(event.occurredAt());
                task.applySoftUpdate(event.taskRevision(), event.attemptNumber(), receivedAt);
            }
            case "attempt.cancelled" -> {
                attempt.cancel(event.occurredAt());
                task.cancel(event.taskRevision(), event.attemptNumber(), receivedAt);
            }
            case "attempt.completed" -> {
                attempt.projectTerminal(AgentTaskAttemptStatus.COMPLETED, null, event.occurredAt());
                AgentTaskStatus result = "COMPLETED_REUSED".equals(event.data().get("task_status"))
                    ? AgentTaskStatus.COMPLETED_REUSED : AgentTaskStatus.COMPLETED;
                task.complete(event.taskRevision(), event.attemptNumber(), result, receivedAt);
            }
            case "attempt.failed" -> attempt.projectTerminal(AgentTaskAttemptStatus.FAILED,
                textValue(event.data().get("failure_code")), event.occurredAt());
            case "attempt.retry_decided" -> {
                attempt.projectRetryDecision(event.data(), event.occurredAt());
                task.projectRetryDecision(event.taskRevision(), event.attemptNumber(),
                    "ALLOW".equals(event.data().get("decision")), textValue(event.data().get("reason")), receivedAt);
            }
            default -> { }
        }
        if (event.phase() != null && !event.phase().isBlank()) {
            task.projectProgress(event.taskRevision(), event.attemptNumber(), event.phase(),
                activity(event), receivedAt);
        }
    }

    private static String activity(IngestAgentTaskEventRequest event) {
        if ("attempt.retry_decided".equals(event.eventType()) && event.data().get("reason") != null) {
            return String.valueOf(event.data().get("reason"));
        }
        return event.milestone() == null || event.milestone().isBlank() ? event.eventType() : event.milestone();
    }

    private static String textValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static void validate(IngestAgentTaskEventRequest request, java.util.UUID workspaceId, java.util.UUID runId) {
        if (!workspaceId.equals(request.workspaceId()) || !runId.equals(request.runId())) {
            throw new IllegalArgumentException("task event scope does not match workload identity");
        }
        if (!SCHEMA_VERSION.equals(request.schemaVersion()) || !EVENT_TYPES.contains(request.eventType())) {
            throw new IllegalArgumentException("task event contract is unsupported");
        }
        if (containsForbiddenKey(request.data())) throw new IllegalArgumentException("task event data contains forbidden fields");
    }

    private static boolean containsForbiddenKey(Object value) {
        if (value instanceof Map<?, ?> map) {
            return map.entrySet().stream().anyMatch(entry -> FORBIDDEN_KEYS.contains(String.valueOf(entry.getKey()).toLowerCase())
                || containsForbiddenKey(entry.getValue()));
        }
        if (value instanceof Iterable<?> iterable) {
            for (Object item : iterable) if (containsForbiddenKey(item)) return true;
        }
        return false;
    }

    private static AgentTaskEventEntity entity(IngestAgentTaskEventRequest request, Instant receivedAt) {
        return new AgentTaskEventEntity(request.eventId(), request.workspaceId(), request.runId(), request.taskId(),
            request.taskRevision(), request.attemptId(), request.attemptNumber(), request.schemaVersion(), request.source(),
            request.sourceEventId(), request.sequence(), request.eventType(), request.phase(), request.milestone(),
            request.data(), request.occurredAt(), receivedAt);
    }

    private static boolean sameIdentity(AgentTaskEventEntity first, AgentTaskEventEntity second) {
        return first.eventId().equals(second.eventId()) && first.workspaceId().equals(second.workspaceId())
            && first.runId().equals(second.runId()) && first.taskId().equals(second.taskId())
            && first.taskRevision() == second.taskRevision() && first.attemptId().equals(second.attemptId())
            && first.attemptNumber() == second.attemptNumber() && first.source().equals(second.source())
            && first.sourceEventId().equals(second.sourceEventId()) && first.sequence() == second.sequence()
            && first.schemaVersion().equals(second.schemaVersion()) && first.eventType().equals(second.eventType())
            && java.util.Objects.equals(first.phase(), second.phase())
            && java.util.Objects.equals(first.milestone(), second.milestone())
            && first.occurredAt().equals(second.occurredAt()) && first.data().equals(second.data());
    }
}
