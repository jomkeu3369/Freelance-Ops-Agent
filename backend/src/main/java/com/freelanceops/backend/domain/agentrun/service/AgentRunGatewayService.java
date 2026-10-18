package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.AgentEventStream;
import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.AgentInput;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.TrustedRunContext;
import com.freelanceops.backend.domain.agentrun.dto.AttachmentText;
import com.freelanceops.backend.domain.agentrun.dto.SkillSelection;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.client.AgentEventStreamResponseException;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.project.service.ProjectAgentRunCleanup;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class AgentRunGatewayService implements ProjectAgentRunCleanup {

    private static final EnumSet<AgentRunStatus> ACTIVE_STATUSES =
            EnumSet.of(
                    AgentRunStatus.QUEUED, AgentRunStatus.RUNNING, AgentRunStatus.WAITING_FOR_USER);
    private final WorkspacePermissionReader permissionReader;
    private final ProjectRepository projectRepository;
    private final AgentRunRepository agentRunRepository;
    private final DelegationTokenIssuer tokenIssuer;
    private final AgentRunClient agentRunClient;
    private final AgentRunProjectionService projectionService;
    private final AgentRunCommandQueue commandQueue;
    private final AgentBudgetPolicy budgetPolicy;
    private final PetProfileService pets;
    private final ChatAttachmentService attachments;
    private final AgentStartIdempotencyService idempotency;
    private final PlatformSpendService platformSpend;
    private final ByokExecutionService byok;
    private final AIConnectionService connections;

    public AgentRunGatewayService(
            WorkspacePermissionReader permissionReader,
            ProjectRepository projectRepository,
            AgentRunRepository agentRunRepository,
            DelegationTokenIssuer tokenIssuer,
            AgentRunClient agentRunClient,
            AgentRunProjectionService projectionService,
            AgentRunCommandQueue commandQueue,
            AgentBudgetPolicy budgetPolicy,
            AIConnectionService connections,
            PetProfileService pets,
            AgentStartIdempotencyService idempotency,
            PlatformSpendService platformSpend,
            ChatAttachmentService attachments,
            ByokExecutionService byok) {
        this.permissionReader = permissionReader;
        this.projectRepository = projectRepository;
        this.agentRunRepository = agentRunRepository;
        this.tokenIssuer = tokenIssuer;
        this.agentRunClient = agentRunClient;
        this.projectionService = projectionService;
        this.commandQueue = commandQueue;
        this.budgetPolicy = budgetPolicy;
        this.connections = connections;
        this.pets = pets;
        this.idempotency = idempotency;
        this.platformSpend = platformSpend;
        this.attachments = attachments;
        this.byok = byok;
    }

    @Transactional
    public StartAgentRunResponse start(
            UUID userId,
            UUID workspaceId,
            UUID projectId,
            StartAgentRunRequest request,
            String traceparent) {
        return start(userId, workspaceId, projectId, request, traceparent, null);
    }

    @Transactional
    public StartAgentRunResponse start(
            UUID userId,
            UUID workspaceId,
            UUID projectId,
            StartAgentRunRequest request,
            String traceparent,
            String idempotencyKey) {
        // 개인 키의 실행 한도는 권한 확인 후 검증한다. 공용 실행은 운영 정책의 상한을 따른다.
        if (request.modelSelection().credentialId() == null) budgetPolicy.enforce(request.budget());
        if (request.modelSelection().credentialId() != null
                && request.budget().maxDurationSeconds() > 270) {
            throw new ResponseStatusException(
                    HttpStatus.UNPROCESSABLE_CONTENT,
                    "Personal AI runs support a maximum duration of 270 seconds");
        }
        MembershipPermissions membership =
                permissionReader
                        .findActiveMembership(userId, workspaceId)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requirePermission(membership, PermissionCode.AGENT_RUN);
        requirePermission(membership, PermissionCode.PROJECT_READ);
        ProjectEntity project =
                projectRepository
                        .findByIdAndWorkspaceIdForUpdate(projectId, workspaceId)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (project.deletionRequested()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "project deletion is in progress");
        }

        Optional<StartAgentRunResponse> replay =
                idempotency.replay(userId, idempotencyKey, workspaceId, projectId, request);
        if (replay.isPresent()) return replay.get();
        var attachmentText =
                request.attachmentIds().isEmpty()
                        ? List.<AttachmentText>of()
                        : attachments.resolve(
                                userId, workspaceId, projectId, request.attachmentIds());

        PlatformSpendTariff.validateSelection(request.modelSelection());
        connections.validate(
                userId,
                workspaceId,
                request.modelSelection().credentialId(),
                request.modelSelection().provider(),
                request.modelSelection().model());
        UUID runId = UUID.randomUUID();
        // 개인 키 실행은 발급된 범위 안에서만 호출한다. 호출 시도 한도와 운영자의 금액 예약은 별도로 관리한다.
        var byokBudget =
                request.modelSelection().credentialId() == null
                        ? null
                        : byok.issue(
                                runId,
                                userId,
                                workspaceId,
                                projectId,
                                request.modelSelection(),
                                request.budget(),
                                request.byokCostNoticeVersion());
        if (request.modelSelection().credentialId() != null && byokBudget == null)
            throw new IllegalStateException("Personal execution admission did not issue a scope");
        var platformBudget =
                request.modelSelection().credentialId() == null
                        ? platformSpend.reserve(userId, runId, request.modelSelection())
                        : null;
        UUID threadId = UUID.randomUUID();
        List<String> permissions =
                membership.permissions().stream()
                        .map(PermissionCode::code)
                        .sorted(Comparator.naturalOrder())
                        .toList();
        TrustedRunContext context =
                new TrustedRunContext(
                        runId,
                        threadId,
                        traceparent,
                        workspaceId,
                        project.id(),
                        userId,
                        permissions);
        InternalAgentRunRequest internalRequest =
                new InternalAgentRunRequest(
                        context,
                        request.budget(),
                        request.modelSelection(),
                        request.safetyContext(),
                        new AgentInput(
                                request.requirementText(),
                                request.locale(),
                                request.jurisdictionCode(),
                                null,
                                pets.list(userId, workspaceId),
                                attachmentText,
                                request.skillSelection() == null
                                        ? new SkillSelection(null, null, null, null)
                                        : request.skillSelection(),
                                request.workflowMode()),
                        platformBudget,
                        byokBudget);
        AgentRunEntity run =
                new AgentRunEntity(
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
                        Instant.now());
        run.useCredential(request.modelSelection().credentialId());
        agentRunRepository.saveAndFlush(run);
        commandQueue.enqueueStart(runId, internalRequest, userId, permissions, traceparent);
        StartAgentRunResponse accepted =
                new StartAgentRunResponse(runId, AgentRunStatus.QUEUED, Instant.now());
        idempotency.rememberStart(
                userId, idempotencyKey, workspaceId, projectId, request, accepted);
        attachments.consume(userId, workspaceId, projectId, request.attachmentIds());
        return accepted;
    }

    public AgentRunView get(UUID userId, UUID workspaceId, UUID runId, String traceparent) {
        try {
            return getRemote(userId, workspaceId, runId, traceparent);
        } catch (RestClientResponseException error) {
            if (!error.getStatusCode().equals(HttpStatus.NOT_FOUND)) throw error;
            // Spring commits the run/outbox before the dispatcher creates the
            // Agent record. A read in that interval still has a durable QUEUED run.
            AgentRunEntity pending = agentRunRepository.findByIdAndWorkspaceId(runId, workspaceId)
                .filter(run -> run.status() == AgentRunStatus.QUEUED).orElseThrow(() -> error);
            return projectionService.pendingDelivery(pending);
        }
    }

    private AgentRunView getRemote(UUID userId, UUID workspaceId, UUID runId, String traceparent) {
        AuthorizedRun authorized = authorizeRun(userId, workspaceId, runId, PermissionCode.AGENT_RUN);
        AgentRunView response = agentRunClient.get(
            runId,
            issueToken(authorized.run(), userId, authorized.permissions()),
            traceparent
        );
        requireMatchingRun(runId, response == null ? null : response.runId());
        return projectionService.synchronize(runId, workspaceId, response);
    }

    public Optional<AgentRunView> latestForProject(
            UUID userId, UUID workspaceId, UUID projectId, String traceparent) {
        MembershipPermissions membership =
                permissionReader
                        .findActiveMembership(userId, workspaceId)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requirePermission(membership, PermissionCode.AGENT_RUN);
        requirePermission(membership, PermissionCode.PROJECT_READ);
        if (projectRepository.findByIdAndWorkspaceId(projectId, workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return agentRunRepository
                .findFirstByWorkspaceIdAndProjectIdOrderByUpdatedAtDesc(workspaceId, projectId)
                .map(run -> get(userId, workspaceId, run.id(), traceparent));
    }

    public void cancelActiveForProject(
            UUID userId, UUID workspaceId, UUID projectId, String traceparent) {
        MembershipPermissions membership =
                permissionReader
                        .findActiveMembership(userId, workspaceId)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requirePermission(membership, PermissionCode.PROJECT_READ);
        requirePermission(membership, PermissionCode.AGENT_RUN);
        requirePermission(membership, PermissionCode.AGENT_CANCEL);
        if (projectRepository.findByIdAndWorkspaceId(projectId, workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        List<AgentRunEntity> activeRuns =
                agentRunRepository.findAllByWorkspaceIdAndProjectIdAndStatusIn(
                        workspaceId, projectId, ACTIVE_STATUSES);
        for (AgentRunEntity activeRun : activeRuns) {
            Optional<AgentRunView> current =
                    synchronizeForProjectDeletion(userId, workspaceId, activeRun, traceparent);
            if (current.isPresent() && ACTIVE_STATUSES.contains(current.get().status())) {
                cancel(userId, workspaceId, activeRun.id(), traceparent);
            }
        }
    }

    private Optional<AgentRunView> synchronizeForProjectDeletion(
            UUID userId, UUID workspaceId, AgentRunEntity activeRun, String traceparent) {
        try {
            return Optional.of(getRemote(userId, workspaceId, activeRun.id(), traceparent));
        } catch (RestClientResponseException error) {
            if (!error.getStatusCode().equals(HttpStatus.NOT_FOUND)) {
                throw error;
            }
            synchronizeStatus(activeRun, AgentRunStatus.CANCELLED);
            return Optional.empty();
        }
    }

    @Transactional
    public StartAgentRunResponse resume(
            UUID userId,
            UUID workspaceId,
            UUID runId,
            ResumeAgentRunRequest request,
            String traceparent) {
        AuthorizedRun authorized =
                authorizeRun(userId, workspaceId, runId, PermissionCode.AGENT_RESPOND, true);
        if (authorized.run().credentialId() != null) {
            if (!userId.equals(authorized.run().initiatedBy()))
                throw new ResponseStatusException(HttpStatus.FORBIDDEN);
            connections.validate(
                    userId,
                    workspaceId,
                    authorized.run().credentialId(),
                    authorized.run().provider(),
                    authorized.run().model());
            byok.validateRun(authorized.run());
        }
        projectRepository
                .findByIdAndWorkspaceIdForUpdate(authorized.run().projectId(), workspaceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND))
                .requireNotDeleting();
        projectionService.validateResume(runId, workspaceId, request);
        commandQueue.enqueueResume(runId, request, userId, authorized.permissions(), traceparent);
        projectionService.acceptResume(runId, workspaceId, request, AgentRunStatus.QUEUED);
        return new StartAgentRunResponse(runId, AgentRunStatus.QUEUED, Instant.now());
    }

    public AgentRunView cancel(UUID userId, UUID workspaceId, UUID runId, String traceparent) {
        AuthorizedRun authorized =
                authorizeRun(userId, workspaceId, runId, PermissionCode.AGENT_CANCEL);
        byok.close(runId);
        AgentRunView response =
                agentRunClient.cancel(
                        runId,
                        issueToken(authorized.run(), userId, authorized.permissions()),
                        traceparent);
        requireMatchingRun(runId, response == null ? null : response.runId());
        return projectionService.synchronize(runId, workspaceId, response);
    }

    public AgentEventStream events(UUID userId, UUID workspaceId, UUID runId, Long lastEventId, String traceparent) {
        AuthorizedRun authorized = authorizeRun(userId, workspaceId, runId, PermissionCode.AGENT_RUN);
        try {
            return agentRunClient.events(
                runId, lastEventId, issueToken(authorized.run(), userId, authorized.permissions()), traceparent);
        } catch (AgentEventStreamResponseException error) {
            if (error.statusCode() != 404) throw error;
            agentRunRepository.findByIdAndWorkspaceId(runId, workspaceId)
                .filter(run -> run.status() == AgentRunStatus.QUEUED).orElseThrow(() -> error);
            // Delivery has not created the upstream stream yet. End without
            // emitting a synthetic event or advancing the browser's cursor.
            return new AgentEventStream(java.io.InputStream.nullInputStream());
        }
    }

    private AuthorizedRun authorizeRun(
            UUID userId, UUID workspaceId, UUID runId, PermissionCode permission) {
        return authorizeRun(userId, workspaceId, runId, permission, false);
    }

    private AuthorizedRun authorizeRun(
            UUID userId, UUID workspaceId, UUID runId, PermissionCode permission, boolean lockRun) {
        MembershipPermissions membership =
                permissionReader
                        .findActiveMembership(userId, workspaceId)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requirePermission(membership, permission);
        AgentRunEntity run =
                (lockRun ? agentRunRepository.findByIdAndWorkspaceIdForUpdate(runId, workspaceId)
                        : agentRunRepository.findByIdAndWorkspaceId(runId, workspaceId))
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
    public void cancelActiveRuns(
            UUID userId, UUID workspaceId, UUID projectId, String traceparent) {
        MembershipPermissions membership =
                permissionReader
                        .findActiveMembership(userId, workspaceId)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        requirePermission(membership, PermissionCode.PROJECT_DELETE);
        if (projectRepository.findByIdAndWorkspaceId(projectId, workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        HashSet<String> effectivePermissions = new HashSet<>(permissionCodes(membership));
        effectivePermissions.add(PermissionCode.AGENT_RUN.code());
        effectivePermissions.add(PermissionCode.AGENT_CANCEL.code());
        List<String> cleanupPermissions = effectivePermissions.stream().sorted().toList();
        List<AgentRunEntity> activeRuns =
                agentRunRepository.findAllByWorkspaceIdAndProjectIdAndStatusIn(
                        workspaceId, projectId, ACTIVE_STATUSES);
        for (AgentRunEntity run : activeRuns) {
            String token =
                    tokenIssuer.issue(run.id(), workspaceId, projectId, userId, cleanupPermissions);
            AgentRunView current;
            try {
                current = agentRunClient.get(run.id(), token, traceparent);
            } catch (RestClientResponseException error) {
                if (!error.getStatusCode().equals(HttpStatus.NOT_FOUND)) throw error;
                projectionService.synchronizeStatus(
                        run.id(), workspaceId, AgentRunStatus.CANCELLED);
                continue;
            }
            requireMatchingRun(run.id(), current == null ? null : current.runId());
            projectionService.synchronize(run.id(), workspaceId, current);
            if (!ACTIVE_STATUSES.contains(current.status())) continue;
            AgentRunView cancelled = agentRunClient.cancel(run.id(), token, traceparent);
            requireMatchingRun(run.id(), cancelled == null ? null : cancelled.runId());
            if (cancelled.status() != AgentRunStatus.CANCELLED) {
                throw new ResponseStatusException(
                        HttpStatus.CONFLICT, "Agent run did not acknowledge cancellation");
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
            throw new IllegalStateException(
                    "agent response run id does not match the issued run id");
        }
    }

    private static void requirePermission(
            MembershipPermissions membership, PermissionCode permission) {
        if (!membership.permissions().contains(permission)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
    }

    private record AuthorizedRun(AgentRunEntity run, List<String> permissions) {}
}
