package com.freelanceops.backend.domain.agentrun.service;
import org.springframework.context.ApplicationEventPublisher;
import com.freelanceops.backend.domain.agentrun.model.DepartmentName;
import com.freelanceops.backend.global.event.RequirementAnalysisCompleted;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentInterruptionEntity;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import java.time.Instant;
import java.util.UUID;

@Service
public class AgentRunProjectionService {

    private static final java.time.Duration RECONCILIATION_INTERVAL = java.time.Duration.ofSeconds(5);

    private final AgentRunRepository runRepository;
    private final AgentInterruptionService interruptionService;
    private final AgentCostService costService;
    private final ApplicationEventPublisher events;
    private final FreeUsageService freeUsage;
    private final ByokExecutionService byok;

    public AgentRunProjectionService(AgentRunRepository runRepository, AgentInterruptionService interruptionService, AgentCostService costService, ApplicationEventPublisher events, FreeUsageService freeUsage, ByokExecutionService byok) {
        this.runRepository = runRepository;
        this.interruptionService = interruptionService;
        this.costService = costService;
        this.events = events;
        this.freeUsage = freeUsage;
        this.byok = byok;
    }

    @Transactional
    public void synchronize(UUID runId, UUID workspaceId, AgentRunView view) {
        AgentRunEntity run = lock(runId, workspaceId);
        interruptionService.synchronize(run, view);
        costService.synchronize(run, view);
        freeUsage.settleConfirmed(run.id(), view.status());
        if (view.status() == AgentRunStatus.COMPLETED && view.result() != null) {
            view.result().departmentResults().stream()
                .filter(result -> result.department() == DepartmentName.REQUIREMENTS && "COMPLETED".equals(result.status()))
                .findFirst().ifPresent(result -> events.publishEvent(new RequirementAnalysisCompleted(
                    run.id(), run.workspaceId(), run.projectId(), run.initiatedBy(), result.summary(), view.result().referencedDocumentIds()
                )));
        }
        byok.closeIfTerminal(run.id(), view.status());
        run.synchronizeStatus(view.status(), Instant.now());
        run.scheduleReconciliation(Instant.now().plus(RECONCILIATION_INTERVAL));
    }

    @Transactional
    public void validateResume(UUID runId, UUID workspaceId, ResumeAgentRunRequest request) {
        AgentRunEntity run = lock(runId, workspaceId);
        interruptionService.requirePending(run, request);
    }

    @Transactional
    public void acceptResume(UUID runId, UUID workspaceId, ResumeAgentRunRequest request, AgentRunStatus status) {
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

    /** Use only for status acknowledged by the Agent, never a locally inferred delivery failure. */
    @Transactional
    public void synchronizeAcknowledgedStatus(UUID runId, UUID workspaceId, AgentRunStatus status) {
        if (status == null) throw new IllegalStateException("Agent did not acknowledge a run status");
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
        return runRepository.findByIdAndWorkspaceIdForUpdate(runId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
}
