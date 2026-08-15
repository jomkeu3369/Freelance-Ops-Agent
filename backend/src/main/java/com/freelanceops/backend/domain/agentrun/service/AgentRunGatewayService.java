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
import com.freelanceops.backend.domain.agentrun.entity.AgentInterruptionEntity;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.time.Instant;

@Service
public class AgentRunGatewayService {

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
    private final AgentInterruptionService interruptionService;
    private final AgentCostService costService;
    private final AgentBudgetPolicy budgetPolicy;

    public AgentRunGatewayService(WorkspacePermissionReader permissionReader, ProjectRepository projectRepository, AgentRunRepository agentRunRepository, DelegationTokenIssuer tokenIssuer, AgentRunClient agentRunClient, AgentInterruptionService interruptionService, AgentCostService costService, AgentBudgetPolicy budgetPolicy) {
        this.permissionReader = permissionReader;
        this.projectRepository = projectRepository;
        this.agentRunRepository = agentRunRepository;
        this.tokenIssuer = tokenIssuer;
        this.agentRunClient = agentRunClient;
        this.interruptionService = interruptionService;
        this.costService = costService;
        this.budgetPolicy = budgetPolicy;
    }

    public StartAgentRunResponse start(UUID userId, UUID workspaceId, UUID projectId, StartAgentRunRequest request, String traceparent) {
        budgetPolicy.enforce(request.budget());
        MembershipPermissions membership = permissionReader.findActiveMembership(userId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requirePermission(membership, PermissionCode.AGENT_RUN);
        requirePermission(membership, PermissionCode.PROJECT_READ);
        ProjectEntity project = projectRepository.findByIdAndWorkspaceId(projectId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        UUID runId = UUID.randomUUID();
        UUID threadId = UUID.randomUUID();
        List<String> permissions = membership.permissions().stream()
            .map(PermissionCode::code)
            .sorted(Comparator.naturalOrder())
            .toList();
        String token = tokenIssuer.issue(runId, workspaceId, project.id(), userId, permissions);
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
            AgentRunStatus.QUEUED,
            Instant.now()
        );
        agentRunRepository.save(run);
        try {
            StartAgentRunResponse response = agentRunClient.start(internalRequest, token, traceparent);
            requireMatchingRun(runId, response == null ? null : response.runId());
            run.updateStatus(response.status(), Instant.now());
            agentRunRepository.save(run);
            return response;
        } catch (RuntimeException error) {
            run.updateStatus(AgentRunStatus.FAILED, Instant.now());
            agentRunRepository.save(run);
            throw error;
        }
    }

    public AgentRunView get(UUID userId, UUID workspaceId, UUID runId, String traceparent) {
        AuthorizedRun authorized = authorizeRun(userId, workspaceId, runId, PermissionCode.AGENT_RUN);
        AgentRunView response = agentRunClient.get(
            runId,
            issueToken(authorized.run(), userId, authorized.permissions()),
            traceparent
        );
        requireMatchingRun(runId, response == null ? null : response.runId());
        interruptionService.synchronize(authorized.run(), response);
        costService.synchronize(authorized.run(), response);
        authorized.run().updateStatus(response.status(), Instant.now());
        agentRunRepository.save(authorized.run());
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
            AgentRunView current = get(userId, workspaceId, activeRun.id(), traceparent);
            if (ACTIVE_STATUSES.contains(current.status())) {
                cancel(userId, workspaceId, activeRun.id(), traceparent);
            }
        }
    }

    public StartAgentRunResponse resume(UUID userId, UUID workspaceId, UUID runId, ResumeAgentRunRequest request, String traceparent) {
        AuthorizedRun authorized = authorizeRun(userId, workspaceId, runId, PermissionCode.AGENT_RESPOND);
        String token = issueToken(authorized.run(), userId, authorized.permissions());
        AgentRunView current = agentRunClient.get(runId, token, traceparent);
        requireMatchingRun(runId, current == null ? null : current.runId());
        interruptionService.synchronize(authorized.run(), current);
        costService.synchronize(authorized.run(), current);
        AgentInterruptionEntity interruption = interruptionService.requirePending(authorized.run(), request);
        StartAgentRunResponse response = agentRunClient.resume(
            runId,
            request,
            token,
            traceparent
        );
        requireMatchingRun(runId, response == null ? null : response.runId());
        interruptionService.markResponded(interruption, request, Instant.now());
        authorized.run().updateStatus(response.status(), Instant.now());
        agentRunRepository.save(authorized.run());
        return response;
    }

    public AgentRunView cancel(UUID userId, UUID workspaceId, UUID runId, String traceparent) {
        AuthorizedRun authorized = authorizeRun(userId, workspaceId, runId, PermissionCode.AGENT_CANCEL);
        AgentRunView response = agentRunClient.cancel(
            runId,
            issueToken(authorized.run(), userId, authorized.permissions()),
            traceparent
        );
        requireMatchingRun(runId, response == null ? null : response.runId());
        interruptionService.synchronize(authorized.run(), response);
        costService.synchronize(authorized.run(), response);
        authorized.run().updateStatus(response.status(), Instant.now());
        agentRunRepository.save(authorized.run());
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


