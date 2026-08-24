package com.freelanceops.backend.domain.agentrun.service;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunCommandEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunCommandType;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunCommandRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import com.freelanceops.backend.domain.project.model.ProjectDeletionInProgressException;
import com.freelanceops.backend.domain.project.service.ProjectAgentCommandFence;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class AgentRunCommandQueue implements ProjectAgentCommandFence {

    private static final Duration LEASE = Duration.ofMinutes(2);
    private final AgentRunCommandRepository repository;
    private final ObjectMapper objectMapper;

    public AgentRunCommandQueue(AgentRunCommandRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public UUID enqueueStart(UUID runId, InternalAgentRunRequest request, UUID requestedBy,
                             List<String> permissions, String traceparent) {
        return enqueue(runId, AgentRunCommandType.START, request, requestedBy, permissions, traceparent);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public UUID enqueueResume(UUID runId, ResumeAgentRunRequest request, UUID requestedBy,
                              List<String> permissions, String traceparent) {
        return enqueue(runId, AgentRunCommandType.RESUME, request, requestedBy, permissions, traceparent);
    }

    @Transactional
    public Optional<ClaimedCommand> claimNext() {
        Instant now = Instant.now();
        return repository.findDispatchableForUpdate(now, PageRequest.of(0, 1)).stream()
            .findFirst()
            .map(command -> claim(command, now));
    }

    @Transactional
    public boolean complete(UUID commandId, int claimedAttempt) {
        return repository.findByIdForUpdate(commandId)
            .map(command -> command.complete(Instant.now(), claimedAttempt))
            .orElse(false);
    }

    @Transactional
    public boolean retry(UUID commandId, int claimedAttempt, Duration delay, String error) {
        return repository.findByIdForUpdate(commandId)
            .map(command -> command.retry(Instant.now(), delay, error, claimedAttempt))
            .orElse(false);
    }

    @Transactional
    public boolean fail(UUID commandId, int claimedAttempt, String error) {
        return repository.findByIdForUpdate(commandId)
            .map(command -> command.fail(Instant.now(), error, claimedAttempt))
            .orElse(false);
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void requireNoInFlightCommands(UUID workspaceId, UUID projectId) {
        if (repository.existsInFlightForProject(workspaceId, projectId, Instant.now())) {
            throw new ProjectDeletionInProgressException();
        }
    }

    private UUID enqueue(UUID runId, AgentRunCommandType type, Object payload, UUID requestedBy,
                         List<String> permissions, String traceparent) {
        Instant now = Instant.now();
        AgentRunCommandEntity command = new AgentRunCommandEntity(
            UUID.randomUUID(), runId, type, json(payload), requestedBy, json(permissions), traceparent, now
        );
        return repository.save(command).id();
    }

    private ClaimedCommand claim(AgentRunCommandEntity command, Instant now) {
        command.claim(now, LEASE);
        return new ClaimedCommand(
            command.id(), command.runId(), command.commandType(), command.payload(), command.requestedBy(),
            readPermissions(command.effectivePermissions()), command.traceparent(), command.attempts()
        );
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JacksonException error) {
            throw new IllegalStateException("agent command could not be serialized", error);
        }
    }

    private List<String> readPermissions(String value) {
        try {
            return objectMapper.readerForListOf(String.class).readValue(value);
        } catch (JacksonException error) {
            throw new IllegalStateException("agent command permissions could not be read", error);
        }
    }

    public record ClaimedCommand(
        UUID id,
        UUID runId,
        AgentRunCommandType type,
        String payload,
        UUID requestedBy,
        List<String> permissions,
        String traceparent,
        int attempts
    ) {
    }
}
