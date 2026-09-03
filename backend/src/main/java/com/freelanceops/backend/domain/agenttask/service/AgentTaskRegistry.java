package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskAttemptEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskDependencyEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskAttemptStatus;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskStatus;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskAttemptRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskDependencyRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class AgentTaskRegistry {

    private final AgentTaskRepository taskRepository;
    private final AgentTaskAttemptRepository attemptRepository;
    private final AgentTaskDependencyRepository dependencyRepository;

    public AgentTaskRegistry(AgentTaskRepository taskRepository, AgentTaskAttemptRepository attemptRepository,
                             AgentTaskDependencyRepository dependencyRepository) {
        this.taskRepository = taskRepository;
        this.attemptRepository = attemptRepository;
        this.dependencyRepository = dependencyRepository;
    }

    @Transactional
    public AgentTaskEntity register(AgentTaskEntity task, Collection<UUID> dependencyTaskIds, Instant now) {
        // A row lock cannot serialize the first insertion of a Task that does not exist yet.
        taskRepository.lockRegistration(task.id());
        var existing = taskRepository.findByIdAndWorkspaceIdForUpdate(task.id(), task.workspaceId());
        if (existing.isPresent()) {
            Set<UUID> requestedDependencies = Set.copyOf(dependencyTaskIds);
            Set<UUID> registeredDependencies = dependencyRepository.findAllByTaskId(task.id()).stream()
                .map(dependency -> dependency.id().dependsOnTaskId()).collect(Collectors.toUnmodifiableSet());
            if (!existing.get().hasSameRegistration(task) || !registeredDependencies.equals(requestedDependencies)) {
                throw new IllegalStateException("task registration idempotency key conflicts with different data");
            }
            return existing.get();
        }
        if (task.parentTaskId() != null) {
            AgentTaskEntity parent = taskRepository.findByIdAndWorkspaceId(task.parentTaskId(), task.workspaceId())
                .orElseThrow(() -> new IllegalArgumentException("parent task was not found in workspace"));
            if (!parent.runId().equals(task.runId())) throw new IllegalArgumentException("parent must belong to the same run");
        }
        Collection<AgentTaskDependencyEntity> dependencies = dependencyTaskIds.stream().distinct().map(dependencyTaskId -> {
            AgentTaskEntity dependency = taskRepository.findByIdAndWorkspaceId(dependencyTaskId, task.workspaceId())
                .orElseThrow(() -> new IllegalArgumentException("dependency was not found in workspace"));
            if (!dependency.runId().equals(task.runId())) throw new IllegalArgumentException("dependency must belong to the same run");
            return new AgentTaskDependencyEntity(task.id(), dependencyTaskId, "SUCCESS", now);
        }).toList();
        AgentTaskEntity registered = taskRepository.saveAndFlush(task);
        dependencyRepository.saveAll(dependencies);
        return registered;
    }

    @Transactional
    public AgentTaskAttemptEntity createAttempt(UUID taskId, UUID workspaceId, int expectedRevision, UUID attemptId,
                                                Double predictedSeconds, String predictionModelVersion,
                                                Map<String, Object> predictionFeatureSnapshot, Instant now) {
        taskRepository.lockRegistration(taskId);
        var existing = attemptRepository.findByIdAndWorkspaceIdForUpdate(attemptId, workspaceId);
        if (existing.isPresent()) {
            AgentTaskAttemptEntity attempt = existing.get();
            if (!attempt.hasSameRegistration(workspaceId, taskId, expectedRevision, predictedSeconds,
                predictionModelVersion, predictionFeatureSnapshot)) {
                throw new IllegalStateException("task attempt idempotency key conflicts with different data");
            }
            return attempt;
        }
        AgentTaskEntity task = lockTask(taskId, workspaceId);
        int attemptNumber = task.dispatch(expectedRevision, now);
        AgentTaskAttemptEntity attempt = new AgentTaskAttemptEntity(attemptId, workspaceId, taskId,
            expectedRevision, attemptNumber, predictedSeconds, predictionModelVersion, predictionFeatureSnapshot, now);
        return attemptRepository.saveAndFlush(attempt);
    }

    @Transactional
    public void startAttempt(UUID taskId, UUID attemptId, UUID workspaceId, int expectedRevision,
                             int attemptNumber, String leaseOwner, Duration leaseDuration, Instant now) {
        AgentTaskEntity task = lockTask(taskId, workspaceId);
        AgentTaskAttemptEntity attempt = lockAttempt(attemptId, workspaceId);
        requireAttemptIdentity(attempt, taskId, expectedRevision, attemptNumber);
        attempt.lease(leaseOwner, leaseDuration, now);
        attempt.start(leaseOwner, now);
        task.start(expectedRevision, attemptNumber, now);
    }

    @Transactional
    public void heartbeat(UUID taskId, UUID attemptId, UUID workspaceId, int expectedRevision, int attemptNumber,
                          String phase, String activity, Instant now) {
        AgentTaskEntity task = lockTask(taskId, workspaceId);
        AgentTaskAttemptEntity attempt = lockAttempt(attemptId, workspaceId);
        requireAttemptIdentity(attempt, taskId, expectedRevision, attemptNumber);
        task.heartbeat(expectedRevision, attemptNumber, phase, activity, now);
    }

    @Transactional
    public boolean completeAttempt(UUID taskId, UUID attemptId, UUID workspaceId, int expectedRevision,
                                   int attemptNumber, AgentTaskStatus taskStatus,
                                   AgentTaskAttemptStatus attemptStatus, String failureCode, Instant now) {
        AgentTaskEntity task = lockTask(taskId, workspaceId);
        if (task.revision() != expectedRevision || task.currentAttemptNumber() != attemptNumber) return false;
        AgentTaskAttemptEntity attempt = lockAttempt(attemptId, workspaceId);
        requireAttemptIdentity(attempt, taskId, expectedRevision, attemptNumber);
        attempt.complete(attemptStatus, failureCode, now);
        return task.complete(expectedRevision, attemptNumber, taskStatus, now);
    }

    @Transactional
    public int hardRedirect(UUID taskId, UUID workspaceId, int expectedRevision, Instant now) {
        AgentTaskEntity task = lockTask(taskId, workspaceId);
        return hardRedirect(task, expectedRevision, task.objectiveReference(), now);
    }

    @Transactional
    public int hardRedirect(UUID taskId, UUID workspaceId, int expectedRevision, String objectiveReference, Instant now) {
        AgentTaskEntity task = lockTask(taskId, workspaceId);
        return hardRedirect(task, expectedRevision, objectiveReference, now);
    }

    @Transactional
    public boolean acknowledgeCancellation(UUID taskId, UUID workspaceId, int expectedRevision, Instant now) {
        AgentTaskEntity task = lockTask(taskId, workspaceId);
        if (task.revision() != expectedRevision) return false;
        int attemptNumber = task.currentAttemptNumber();
        if (attemptNumber > 0) {
            attemptRepository.findCurrentForUpdate(taskId, expectedRevision, attemptNumber)
                .ifPresent(attempt -> attempt.cancel(now));
        }
        return task.cancel(expectedRevision, attemptNumber, now);
    }

    private int hardRedirect(AgentTaskEntity task, int expectedRevision, String objectiveReference, Instant now) {
        int attemptNumber = task.currentAttemptNumber();
        if (attemptNumber > 0) {
            attemptRepository.findCurrentForUpdate(task.id(), expectedRevision, attemptNumber)
                .ifPresent(attempt -> attempt.supersede(now));
        }
        return task.redirect(expectedRevision, objectiveReference, now);
    }

    private AgentTaskEntity lockTask(UUID taskId, UUID workspaceId) {
        return taskRepository.findByIdAndWorkspaceIdForUpdate(taskId, workspaceId)
            .orElseThrow(() -> new IllegalArgumentException("task was not found in workspace"));
    }

    private AgentTaskAttemptEntity lockAttempt(UUID attemptId, UUID workspaceId) {
        return attemptRepository.findByIdAndWorkspaceIdForUpdate(attemptId, workspaceId)
            .orElseThrow(() -> new IllegalArgumentException("task attempt was not found in workspace"));
    }

    private static void requireAttemptIdentity(AgentTaskAttemptEntity attempt, UUID taskId, int revision, int number) {
        if (!attempt.taskId().equals(taskId) || attempt.taskRevision() != revision || attempt.attemptNumber() != number) {
            throw new IllegalStateException("task attempt identity does not match current task revision");
        }
    }
}
