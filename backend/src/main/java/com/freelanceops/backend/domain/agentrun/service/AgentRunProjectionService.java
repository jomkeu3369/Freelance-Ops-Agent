package com.freelanceops.backend.domain.agentrun.service;

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

    private final AgentRunRepository runRepository;
    private final AgentInterruptionService interruptionService;
    private final AgentCostService costService;

    public AgentRunProjectionService(AgentRunRepository runRepository, AgentInterruptionService interruptionService, AgentCostService costService) {
        this.runRepository = runRepository;
        this.interruptionService = interruptionService;
        this.costService = costService;
    }

    @Transactional
    public void synchronize(UUID runId, UUID workspaceId, AgentRunView view) {
        AgentRunEntity run = lock(runId, workspaceId);
        interruptionService.synchronize(run, view);
        costService.synchronize(run, view);
        run.synchronizeStatus(view.status(), Instant.now());
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
    }

    private AgentRunEntity lock(UUID runId, UUID workspaceId) {
        return runRepository.findByIdAndWorkspaceIdForUpdate(runId, workspaceId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
}
