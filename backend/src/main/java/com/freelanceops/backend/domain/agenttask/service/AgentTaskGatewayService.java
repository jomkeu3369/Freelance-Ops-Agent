package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskCancelRequest;
import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskInstructionRequest;
import com.freelanceops.backend.domain.agenttask.dto.request.AgentTaskRedirectRequest;
import com.freelanceops.backend.domain.agenttask.dto.response.AgentTaskCommandResponse;
import com.freelanceops.backend.domain.agenttask.dto.response.AgentTaskResponse;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskExecutionProfileEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskExecutionProfileId;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskCommandType;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskExecutionProfileRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskRepository;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class AgentTaskGatewayService {

    private final WorkspacePermissionReader permissionReader;
    private final AgentRunRepository runRepository;
    private final AgentTaskRepository taskRepository;
    private final AgentTaskExecutionProfileRepository profileRepository;
    private final AgentTaskRegistry registry;
    private final AgentTaskCommandOutbox commandOutbox;

    public AgentTaskGatewayService(WorkspacePermissionReader permissionReader, AgentRunRepository runRepository, AgentTaskRepository taskRepository, AgentTaskExecutionProfileRepository profileRepository, AgentTaskRegistry registry, AgentTaskCommandOutbox commandOutbox) {
        this.permissionReader = permissionReader;
        this.runRepository = runRepository;
        this.taskRepository = taskRepository;
        this.profileRepository = profileRepository;
        this.registry = registry;
        this.commandOutbox = commandOutbox;
    }

    @Transactional(readOnly = true)
    public List<AgentTaskResponse> list(UUID userId, UUID workspaceId, UUID runId) {
        authorizeRun(userId, workspaceId, runId, PermissionCode.AGENT_RUN);
        return taskRepository.findAllByWorkspaceIdAndRunIdOrderByCreatedAtAsc(workspaceId, runId).stream()
            .map(AgentTaskResponse::from).toList();
    }

    @Transactional(readOnly = true)
    public AgentTaskResponse get(UUID userId, UUID workspaceId, UUID runId, UUID taskId) {
        authorizeRun(userId, workspaceId, runId, PermissionCode.AGENT_RUN);
        return AgentTaskResponse.from(requireTask(workspaceId, runId, taskId));
    }

    @Transactional
    public AgentTaskCommandResponse softUpdate(UUID userId, UUID workspaceId, UUID runId, UUID taskId, AgentTaskInstructionRequest request) {
        AuthorizedCommand context = authorizeCommand(userId, workspaceId, runId, taskId, request.expectedRevision(), PermissionCode.AGENT_RESPOND);
        Instant now = Instant.now();
        AgentTaskCommandOutbox.EnqueueResult enqueued;
        try {
            enqueued = commandOutbox.enqueueWithResult(workspaceId, runId, taskId,
                request.expectedRevision(), AgentTaskCommandType.SOFT_UPDATE, request.idempotencyKey(),
                Map.of("instruction", request.instruction()), userId, context.profile().authorizationRevision(),
                context.profile().budgetRevision(), now);
            if (enqueued.created()) context.task().requestSoftUpdate(request.expectedRevision(), now);
        } catch (IllegalStateException error) {
            throw conflict(error);
        }
        return response(enqueued.commandId(), context.task(), now);
    }

    @Transactional
    public AgentTaskCommandResponse hardRedirect(UUID userId, UUID workspaceId, UUID runId, UUID taskId, AgentTaskRedirectRequest request) {
        AuthorizedCommand context = authorizeCommand(userId, workspaceId, runId, taskId, request.expectedRevision(), PermissionCode.AGENT_RESPOND);
        Instant now = Instant.now();
        AgentTaskCommandOutbox.EnqueueResult enqueued;
        try {
            enqueued = commandOutbox.enqueueWithResult(workspaceId, runId, taskId,
                request.expectedRevision(), AgentTaskCommandType.HARD_REDIRECT, request.idempotencyKey(),
                Map.of("objective_reference", request.objectiveReference()), userId,
                context.profile().authorizationRevision(), context.profile().budgetRevision(), now);
            if (enqueued.created()) {
                int revision = registry.hardRedirect(taskId, workspaceId, request.expectedRevision(), request.objectiveReference(), now);
                profileRepository.saveAndFlush(context.profile().copyForRevision(revision, now));
            }
        } catch (IllegalStateException error) {
            throw conflict(error);
        }
        return response(enqueued.commandId(), context.task(), now);
    }

    @Transactional
    public AgentTaskCommandResponse cancel(UUID userId, UUID workspaceId, UUID runId, UUID taskId, AgentTaskCancelRequest request) {
        AuthorizedCommand context = authorizeCommand(userId, workspaceId, runId, taskId, request.expectedRevision(), PermissionCode.AGENT_CANCEL);
        Instant now = Instant.now();
        AgentTaskCommandOutbox.EnqueueResult enqueued;
        try {
            enqueued = commandOutbox.enqueueWithResult(workspaceId, runId, taskId,
                request.expectedRevision(), AgentTaskCommandType.CANCEL, request.idempotencyKey(), Map.of(), userId,
                context.profile().authorizationRevision(), context.profile().budgetRevision(), now);
            if (enqueued.created()) context.task().requestCancellation(request.expectedRevision(), now);
        } catch (IllegalStateException error) {
            throw conflict(error);
        }
        return response(enqueued.commandId(), context.task(), now);
    }

    private AuthorizedCommand authorizeCommand(UUID userId, UUID workspaceId, UUID runId, UUID taskId, int expectedRevision, PermissionCode permission) {
        authorizeRun(userId, workspaceId, runId, permission);
        AgentTaskEntity task = requireTask(workspaceId, runId, taskId);
        AgentTaskExecutionProfileEntity profile = profileRepository.findById(new AgentTaskExecutionProfileId(taskId, expectedRevision))
            .filter(candidate -> candidate.workspaceId().equals(workspaceId) && candidate.runId().equals(runId))
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "task revision is not available"));
        return new AuthorizedCommand(task, profile);
    }

    private void authorizeRun(UUID userId, UUID workspaceId, UUID runId, PermissionCode permission) {
        MembershipPermissions membership = permissionReader.findActiveMembership(userId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!membership.permissions().contains(permission)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        if (!runRepository.existsByIdAndWorkspaceId(runId, workspaceId)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    private AgentTaskEntity requireTask(UUID workspaceId, UUID runId, UUID taskId) {
        AgentTaskEntity task = taskRepository.findByIdAndWorkspaceId(taskId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!task.runId().equals(runId)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return task;
    }

    private static AgentTaskCommandResponse response(UUID commandId, AgentTaskEntity task, Instant acceptedAt) {
        return new AgentTaskCommandResponse(commandId, task.id(), task.revision(), task.status(), acceptedAt);
    }

    private static ResponseStatusException conflict(IllegalStateException error) {
        return new ResponseStatusException(HttpStatus.CONFLICT, error.getMessage(), error);
    }

    private record AuthorizedCommand(AgentTaskEntity task, AgentTaskExecutionProfileEntity profile) {
    }
}
