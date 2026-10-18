package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentInterruptionEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.DepartmentName;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.global.event.RequirementAnalysisCompleted;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.UUID;

@Service
public class AgentRunProjectionService {

    private static final java.time.Duration RECONCILIATION_INTERVAL =
            java.time.Duration.ofSeconds(5);

    private final AgentRunRepository runRepository;
    private final AgentInterruptionService interruptionService;
    private final AgentCostService costService;
    private final ApplicationEventPublisher events;
    private final FreeUsageService freeUsage;
    private final ByokExecutionService byok;

    public AgentRunProjectionService(
            AgentRunRepository runRepository,
            AgentInterruptionService interruptionService,
            AgentCostService costService,
            ApplicationEventPublisher events,
            FreeUsageService freeUsage,
            ByokExecutionService byok) {
        this.runRepository = runRepository;
        this.interruptionService = interruptionService;
        this.costService = costService;
        this.events = events;
        this.freeUsage = freeUsage;
        this.byok = byok;
    }

    /** Read only Spring's pending receipt; no Agent result, usage or version has been acknowledged yet. */
    public AgentRunView pendingDelivery(AgentRunEntity run) {
        return new AgentRunView(run.id(), run.status(), null, null, null, null,
            new AgentRunView.AgentRunMetadata(run.provider(), run.model(), null, null, null, run.credentialId()),
            null, run.updatedAt());
    }

    @Transactional
    public AgentRunView synchronize(UUID runId, UUID workspaceId, AgentRunView view) {
        AgentRunEntity run = lock(runId, workspaceId);
        boolean staleAnsweredQuestion = view.status() == AgentRunStatus.WAITING_FOR_USER
                && (run.status() == AgentRunStatus.QUEUED || run.status() == AgentRunStatus.RUNNING)
                && interruptionService.alreadyResponded(run, view.interruption());
        if (!staleAnsweredQuestion) run.synchronizeStatus(view.status(), Instant.now());
        AgentRunView publicView = durableView(run, view);
        interruptionService.synchronize(run, publicView);
        costService.synchronize(run, view);
        freeUsage.settleConfirmed(run.id(), view.status());
        if (run.status() == AgentRunStatus.COMPLETED && view.status() == AgentRunStatus.COMPLETED && view.result() != null) {
            view.result().departmentResults().stream()
                    .filter(
                            result ->
                                    result.department() == DepartmentName.REQUIREMENTS
                                            && "COMPLETED".equals(result.status()))
                    .findFirst()
                    .ifPresent(
                            result ->
                                    events.publishEvent(
                                            new RequirementAnalysisCompleted(
                                                    run.id(),
                                                    run.workspaceId(),
                                                    run.projectId(),
                                                    run.initiatedBy(),
                                                    result.summary(),
                                                    view.result().referencedDocumentIds())));
        }
        byok.closeIfTerminal(run.id(), view.status());
        run.scheduleReconciliation(Instant.now().plus(RECONCILIATION_INTERVAL));
        return publicView;
    }

    private static AgentRunView durableView(AgentRunEntity run, AgentRunView view) {
        if (run.status() == view.status()) return view;
        // Keep unsuccessful-run snapshots and late usage readable without reopening
        // a stale question or presenting them as a completed source.
        return new AgentRunView(view.runId(), run.status(),
            run.status() == AgentRunStatus.RUNNING ? view.activeDepartment() : null,
            run.status() == AgentRunStatus.WAITING_FOR_USER ? view.interruption() : null,
            // A durable completion does not make an older incomplete payload complete.
            run.status() == AgentRunStatus.COMPLETED ? null : view.result(),
            view.errorCode(), view.metadata(), view.usage(), view.updatedAt());
    }

    @Transactional
    public void validateResume(UUID runId, UUID workspaceId, ResumeAgentRunRequest request) {
        AgentRunEntity run = lock(runId, workspaceId);
        interruptionService.requirePending(run, request);
    }

    @Transactional
    public void acceptResume(
            UUID runId, UUID workspaceId, ResumeAgentRunRequest request, AgentRunStatus status) {
        AgentRunEntity run = lock(runId, workspaceId);
        AgentInterruptionEntity interruption = interruptionService.requirePending(run, request);
        interruptionService.markResponded(interruption, request, Instant.now());
        run.synchronizeStatus(status, Instant.now());
    }

    @Transactional
    public void synchronizeStatus(UUID runId, UUID workspaceId, AgentRunStatus status) {
        lock(runId, workspaceId).synchronizeStatus(status, Instant.now());
        byok.closeIfTerminal(runId, status);
    }

    /** Agent가 확인한 상태에만 사용한다. 로컬에서 추정한 전달 실패에는 사용하지 않는다. */
    @Transactional
    public void synchronizeAcknowledgedStatus(UUID runId, UUID workspaceId, AgentRunStatus status) {
        if (status == null)
            throw new IllegalStateException("Agent did not acknowledge a run status");
        AgentRunEntity run = lock(runId, workspaceId);
        freeUsage.settleConfirmed(run.id(), status);
        byok.closeIfTerminal(run.id(), status);
        run.synchronizeStatus(status, Instant.now());
    }

    @Transactional
    public void deferReconciliation(UUID runId, UUID workspaceId, Instant nextAttempt) {
        lock(runId, workspaceId).scheduleReconciliation(nextAttempt);
    }

    private AgentRunEntity lock(UUID runId, UUID workspaceId) {
        return runRepository
                .findByIdAndWorkspaceIdForUpdate(runId, workspaceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
}
