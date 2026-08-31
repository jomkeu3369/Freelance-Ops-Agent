package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.AgentInput;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.TrustedRunContext;
import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.client.AgentEventStream;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.project.service.ProjectAgentRunCleanup;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.time.Instant;

@Service
public class AgentRunGatewayService implements ProjectAgentRunCleanup {

    private static final EnumSet<AgentRunStatus> ACTIVE_STATUSES = EnumSet.of(
        AgentRunStatus.QUEUED,
        AgentRunStatus.RUNNING,
        AgentRunStatus.WAITING_FOR_USER
    );
    private final WorkspacePermissionReader permissionReader;
    private final ProjectRepository projectRepository;
    private final AgentRunRepository agentRunRepository;
    private final DelegationTokenIssuer tokenIssuer;
    private final AgentRunClient agentRunClient;
    private final AgentRunProjectionService projectionService;
    private final AgentRunCommandQueue commandQueue;
    private final AgentBudgetPolicy budgetPolicy;

    public AgentRunGatewayService(WorkspacePermissionReader permissionReader, ProjectRepository projectRepository, AgentRunRepository agentRunRepository, DelegationTokenIssuer tokenIssuer, AgentRunClient agentRunClient, AgentRunProjectionService projectionService, AgentRunCommandQueue commandQueue, AgentBudgetPolicy budgetPolicy) {
        this.permissionReader = permissionReader;
        this.projectRepository = projectRepository;
        this.agentRunRepository = agentRunRepository;
        this.tokenIssuer = tokenIssuer;
        this.agentRunClient = agentRunClient;
        this.projectionService = projectionService;
        this.commandQueue = commandQueue;
        this.budgetPolicy = budgetPolicy;
    }

    @Transactional
    public StartAgentRunResponse start(UUID userId, UUID workspaceId, UUID projectId, StartAgentRunRequest request, String traceparent) {
        budgetPolicy.enforce(request.budget());
        MembershipPermissions membership = permissionReader.findActiveMembership(userId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requirePermission(membership, PermissionCode.AGENT_RUN);
        requirePermission(membership, PermissionCode.PROJECT_READ);
        ProjectEntity project = projectRepository.findByIdAndWorkspaceIdForUpdate(projectId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (project.deletionRequested()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "project deletion is in progress");
        }

        UUID runId = UUID.randomUUID();
        UUID threadId = UUID.randomUUID();
        List<String> permissions = membership.permissions().stream()
            .map(PermissionCode::code)
            .sorted(Comparator.naturalOrder())
            .toList();
        TrustedRunContext context = new TrustedRunContext(
            runId,
            threadId,
            traceparent,
            workspaceId,
            project.id(),
            userId,
            permissions
        );
        InternalAgentRunRequest internalRequest = new InternalAgentRunRequest(
            context,
            request.budget(),
            request.modelSelection(),
            request.safetyContext(),
            new AgentInput(
                request.requirementText(),
                request.locale(),
                request.jurisdictionCode(),
                null
            )
        );
        AgentRunEntity run = new AgentRunEntity(
            runId,
            workspaceId,
            project.id(),
            threadId,
            userId,
            request.modelSelection().provider(),
            request.modelSelection().model(),
            request.modelSelection().reasoningEffort(),
            request.budget(),
            AgentRunStatus.QUEUED,
            Instant.now()
        );
        agentRunRepository.saveAndFlush(run);
        commandQueue.enqueueStart(runId, internalRequest, userId, permissions, traceparent);
        return new StartAgentRunResponse(runId, AgentRunStatus.QUEUED, Instant.now());
    }

    public AgentRunView get(UUID userId, UUID workspaceId, UUID runId, String traceparent) {
        AuthorizedRun authorized = authorizeRun(userId, workspaceId, runId, PermissionCode.AGENT_RUN);
        AgentRunView response = agentRunClient.get(
            runId,
            issueToken(authorized.run(), userId, authorized.permissions()),
            traceparent
        );
        requireMatchingRun(runId, response == null ? null : response.runId());
        projectionService.synchronize(runId, workspaceId, response);
        return response;
    }

    public Optional<AgentRunView> latestForProject(UUID userId, UUID workspaceId, UUID projectId, String traceparent) {
        MembershipPermissions membership = permissionReader.findActiveMembership(userId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requirePermission(membership, PermissionCode.AGENT_RUN);
        requirePermission(membership, PermissionCode.PROJECT_READ);
        if (projectRepository.findByIdAndWorkspaceId(projectId, workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return agentRunRepository.findFirstByWorkspaceIdAndProjectIdOrderByUpdatedAtDesc(workspaceId, projectId)
            .map(run -> get(userId, workspaceId, run.id(), traceparent));
    }

    public void cancelActiveForProject(UUID userId, UUID workspaceId, UUID projectId, String traceparent) {
        MembershipPermissions membership = permissionReader.findActiveMembership(userId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requirePermission(membership, PermissionCode.PROJECT_READ);
        requirePermission(membership, PermissionCode.AGENT_RUN);
        requirePermission(membership, PermissionCode.AGENT_CANCEL);
        if (projectRepository.findByIdAndWorkspaceId(projectId, workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        List<AgentRunEntity> activeRuns = agentRunRepository.findAllByWorkspaceIdAndProjectIdAndStatusIn(
            workspaceId,
            projectId,
            ACTIVE_STATUSES
        );
        for (AgentRunEntity activeRun : activeRuns) {
            Optional<AgentRunView> current = synchronizeForProjectDeletion(
                userId,
                workspaceId,
                activeRun,
                traceparent
            );
            if (current.isPresent() && ACTIVE_STATUSES.contains(current.get().status())) {
                cancel(userId, workspaceId, activeRun.id(), traceparent);
            }
        }
    }

    private Optional<AgentRunView> synchronizeForProjectDeletion(UUID userId, UUID workspaceId, AgentRunEntity activeRun, String traceparent) {
        try {
            return Optional.of(get(userId, workspaceId, activeRun.id(), traceparent));
        } catch (RestClientResponseException error) {
            if (!error.getStatusCode().equals(HttpStatus.NOT_FOUND)) {
                throw error;
            }
            synchronizeStatus(activeRun, AgentRunStatus.CANCELLED);
            return Optional.empty();
        }
    }

    @Transactional
    public StartAgentRunResponse resume(UUID userId, UUID workspaceId, UUID runId, ResumeAgentRunRequest request, String traceparent) {
        AuthorizedRun authorized = authorizeRun(userId, workspaceId, runId, PermissionCode.AGENT_RESPOND);
        projectRepository.findByIdAndWorkspaceIdForUpdate(authorized.run().projectId(), workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND))
            .requireNotDeleting();
        projectionService.validateResume(runId, workspaceId, request);
        commandQueue.enqueueResume(runId, request, userId, authorized.permissions(), traceparent);
        projectionService.acceptResume(runId, workspaceId, request, AgentRunStatus.QUEUED);
        return new StartAgentRunResponse(runId, AgentRunStatus.QUEUED, Instant.now());
    }

    public AgentRunView cancel(UUID userId, UUID workspaceId, UUID runId, String traceparent) {
        AuthorizedRun authorized = authorizeRun(userId, workspaceId, runId, PermissionCode.AGENT_CANCEL);
        AgentRunView response = agentRunClient.cancel(
            runId,
            issueToken(authorized.run(), userId, authorized.permissions()),
            traceparent
        );
        requireMatchingRun(runId, response == null ? null : response.runId());
        projectionService.synchronize(runId, workspaceId, response);
        return response;
    }

    public AgentEventStream events(UUID userId, UUID workspaceId, UUID runId, Long lastEventId, String traceparent) {
        AuthorizedRun authorized = authorizeRun(userId, workspaceId, runId, PermissionCode.AGENT_RUN);
        return agentRunClient.events(
            runId,
            lastEventId,
            issueToken(authorized.run(), userId, authorized.permissions()),
            traceparent
        );
    }

    private AuthorizedRun authorizeRun(UUID userId, UUID workspaceId, UUID runId, PermissionCode permission) {
        MembershipPermissions membership = permissionReader.findActiveMembership(userId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requirePermission(membership, permission);
        AgentRunEntity run = agentRunRepository.findByIdAndWorkspaceId(runId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        return new AuthorizedRun(run, permissionCodes(membership));
    }

    private String issueToken(AgentRunEntity run, UUID userId, List<String> permissions) {
        return tokenIssuer.issue(run.id(), run.workspaceId(), run.projectId(), userId, permissions);
    }

    private void synchronizeStatus(AgentRunEntity run, AgentRunStatus status) {
        projectionService.synchronizeStatus(run.id(), run.workspaceId(), status);
    }

    @Override
    public void cancelActiveRuns(UUID userId, UUID workspaceId, UUID projectId, String traceparent) {
        MembershipPermissions membership = permissionReader.findActiveMembership(userId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requirePermission(membership, PermissionCode.PROJECT_DELETE);
        if (projectRepository.findByIdAndWorkspaceId(projectId, workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        HashSet<String> effectivePermissions = new HashSet<>(permissionCodes(membership));
        effectivePermissions.add(PermissionCode.AGENT_RUN.code());
        effectivePermissions.add(PermissionCode.AGENT_CANCEL.code());
        List<String> cleanupPermissions = effectivePermissions.stream().sorted().toList();
        List<AgentRunEntity> activeRuns = agentRunRepository.findAllByWorkspaceIdAndProjectIdAndStatusIn(
            workspaceId, projectId, ACTIVE_STATUSES
        );
        for (AgentRunEntity run : activeRuns) {
            String token = tokenIssuer.issue(run.id(), workspaceId, projectId, userId, cleanupPermissions);
            AgentRunView current;
            try {
                current = agentRunClient.get(run.id(), token, traceparent);
            } catch (RestClientResponseException error) {
                if (!error.getStatusCode().equals(HttpStatus.NOT_FOUND)) throw error;
                projectionService.synchronizeStatus(run.id(), workspaceId, AgentRunStatus.CANCELLED);
                continue;
            }
            requireMatchingRun(run.id(), current == null ? null : current.runId());
            projectionService.synchronize(run.id(), workspaceId, current);
            if (!ACTIVE_STATUSES.contains(current.status())) continue;
            AgentRunView cancelled = agentRunClient.cancel(run.id(), token, traceparent);
            requireMatchingRun(run.id(), cancelled == null ? null : cancelled.runId());
            if (cancelled.status() != AgentRunStatus.CANCELLED) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Agent run did not acknowledge cancellation");
            }
            projectionService.synchronize(run.id(), workspaceId, cancelled);
        }
    }

    private static List<String> permissionCodes(MembershipPermissions membership) {
        return membership.permissions().stream()
            .map(PermissionCode::code)
            .sorted(Comparator.naturalOrder())
            .toList();
    }

    private static void requireMatchingRun(UUID expected, UUID actual) {
        if (actual == null || !expected.equals(actual)) {
            throw new IllegalStateException("agent response run id does not match the issued run id");
        }
    }

    private static void requirePermission(MembershipPermissions membership, PermissionCode permission) {
        if (!membership.permissions().contains(permission)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
    }

    private record AuthorizedRun(AgentRunEntity run, List<String> permissions) {
    }
}


