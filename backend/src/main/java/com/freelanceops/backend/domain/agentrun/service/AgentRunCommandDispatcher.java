package com.freelanceops.backend.domain.agentrun.service;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunCommandType;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientResponseException;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

@Service
@ConditionalOnProperty(name = "agent.command-dispatch-enabled", havingValue = "true", matchIfMissing = true)
public class AgentRunCommandDispatcher {

    private static final Logger log = LoggerFactory.getLogger(AgentRunCommandDispatcher.class);
    private static final int BATCH_SIZE = 20;
    private final AgentRunCommandQueue queue;
    private final AgentRunRepository runRepository;
    private final ProjectRepository projectRepository;
    private final AgentRunClient client;
    private final DelegationTokenIssuer tokenIssuer;
    private final AgentRunProjectionService projectionService;
    private final ObjectMapper objectMapper;

    public AgentRunCommandDispatcher(AgentRunCommandQueue queue, AgentRunRepository runRepository,
                                     ProjectRepository projectRepository,
                                     AgentRunClient client, DelegationTokenIssuer tokenIssuer,
                                     AgentRunProjectionService projectionService, ObjectMapper objectMapper) {
        this.queue = queue;
        this.runRepository = runRepository;
        this.projectRepository = projectRepository;
        this.client = client;
        this.tokenIssuer = tokenIssuer;
        this.projectionService = projectionService;
        this.objectMapper = objectMapper;
    }

    @Scheduled(fixedDelayString = "${agent.command-dispatch-delay-ms:250}")
    public void dispatchPending() {
        for (int index = 0; index < BATCH_SIZE; index++) {
            Optional<AgentRunCommandQueue.ClaimedCommand> claimed = queue.claimNext();
            if (claimed.isEmpty()) return;
            if (!dispatch(claimed.get())) return;
        }
    }

    boolean dispatch(AgentRunCommandQueue.ClaimedCommand command) {
        AgentRunEntity run = runRepository.findById(command.runId()).orElse(null);
        if (run == null) {
            queue.fail(command.id(), command.attempts(), "agent run no longer exists");
            return true;
        }
        boolean deletionRequested = projectRepository.findByIdAndWorkspaceId(run.projectId(), run.workspaceId())
            .map(project -> project.deletionRequested())
            .orElse(true);
        if (deletionRequested) {
            if (queue.fail(command.id(), command.attempts(), "project deletion is in progress")) {
                projectionService.synchronizeStatus(run.id(), run.workspaceId(), AgentRunStatus.CANCELLED);
            }
            return true;
        }
        String token = tokenIssuer.issue(
            run.id(), run.workspaceId(), run.projectId(), command.requestedBy(), command.permissions()
        );
        try {
            if (command.type() == AgentRunCommandType.START) {
                dispatchStart(command, run, token);
            } else {
                dispatchResume(command, run, token);
            }
        } catch (RuntimeException error) {
            if (reconcile(command, run, token)) return true;
            if (isPermanent(error)) {
                if (queue.fail(command.id(), command.attempts(), errorMessage(error))) {
                    projectionService.synchronizeStatus(run.id(), run.workspaceId(), AgentRunStatus.FAILED);
                }
                return true;
            }
            queue.retry(command.id(), command.attempts(), retryDelay(command.attempts()), errorMessage(error));
            log.warn("Agent command delivery will be retried: commandId={} runId={} attempt={}",
                command.id(), command.runId(), command.attempts());
            return false;
        }
        return true;
    }

    private void dispatchStart(AgentRunCommandQueue.ClaimedCommand command, AgentRunEntity run, String token) {
        InternalAgentRunRequest request = read(command.payload(), InternalAgentRunRequest.class);
        StartAgentRunResponse response = client.start(request, token, command.traceparent());
        requireMatchingRun(run.id(), response == null ? null : response.runId());
        if (compensateForProjectDeletion(command, run, token)) return;
        projectionService.synchronizeStatus(run.id(), run.workspaceId(), response.status());
        queue.complete(command.id(), command.attempts());
    }

    private void dispatchResume(AgentRunCommandQueue.ClaimedCommand command, AgentRunEntity run, String token) {
        ResumeAgentRunRequest request = read(command.payload(), ResumeAgentRunRequest.class);
        StartAgentRunResponse response = client.resume(run.id(), request, token, command.traceparent());
        requireMatchingRun(run.id(), response == null ? null : response.runId());
        if (compensateForProjectDeletion(command, run, token)) return;
        projectionService.synchronizeStatus(run.id(), run.workspaceId(), response.status());
        queue.complete(command.id(), command.attempts());
    }

    private boolean reconcile(AgentRunCommandQueue.ClaimedCommand command, AgentRunEntity run, String token) {
        try {
            AgentRunView view = client.get(run.id(), token, command.traceparent());
            requireMatchingRun(run.id(), view == null ? null : view.runId());
            if (command.type() == AgentRunCommandType.RESUME && view.status() == AgentRunStatus.WAITING_FOR_USER
                && view.interruption() != null) {
                ResumeAgentRunRequest request = read(command.payload(), ResumeAgentRunRequest.class);
                if (request.interruptionId().equals(view.interruption().interruptionId())) return false;
            }
            projectionService.synchronize(run.id(), run.workspaceId(), view);
            queue.complete(command.id(), command.attempts());
            return true;
        } catch (RuntimeException recoveryError) {
            return false;
        }
    }

    private boolean compensateForProjectDeletion(AgentRunCommandQueue.ClaimedCommand command,
                                                  AgentRunEntity run, String token) {
        boolean deletionRequested = projectRepository.findByIdAndWorkspaceId(run.projectId(), run.workspaceId())
            .map(project -> project.deletionRequested())
            .orElse(true);
        if (!deletionRequested) return false;
        AgentRunView cancelled = client.cancel(run.id(), token, command.traceparent());
        requireMatchingRun(run.id(), cancelled == null ? null : cancelled.runId());
        if (cancelled.status() != AgentRunStatus.CANCELLED) {
            throw new IllegalStateException("Agent run did not acknowledge compensating cancellation");
        }
        queue.fail(command.id(), command.attempts(), "project deletion began during Agent command delivery");
        if (projectRepository.findByIdAndWorkspaceId(run.projectId(), run.workspaceId()).isPresent()) {
            projectionService.synchronize(run.id(), run.workspaceId(), cancelled);
        }
        return true;
    }

    private <T> T read(String payload, Class<T> type) {
        try {
            return objectMapper.readValue(payload, type);
        } catch (JacksonException error) {
            throw new IllegalStateException("persisted agent command payload is invalid", error);
        }
    }

    private static boolean isPermanent(RuntimeException error) {
        if (error instanceof IllegalStateException) return true;
        if (error instanceof RestClientResponseException response) {
            int status = response.getStatusCode().value();
            return status >= 400 && status < 500 && status != 408 && status != 429;
        }
        return false;
    }

    private static Duration retryDelay(int attempts) {
        long seconds = Math.min(60, 1L << Math.min(Math.max(attempts - 1, 0), 6));
        return Duration.ofSeconds(seconds);
    }

    private static String errorMessage(Throwable error) {
        String message = error.getMessage();
        return error.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    private static void requireMatchingRun(UUID expected, UUID actual) {
        if (actual == null || !expected.equals(actual)) {
            throw new IllegalStateException("agent response run id does not match the issued run id");
        }
    }
}
