package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentTaskCommandRequest;
import com.freelanceops.backend.domain.agentrun.client.dto.response.InternalAgentTaskCommandResponse;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskCommandType;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientResponseException;

import java.time.Duration;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
@ConditionalOnProperty(name = "agent.command-dispatch-enabled", havingValue = "true", matchIfMissing = true)
public class AgentTaskCommandDispatcher {

    private static final Logger log = LoggerFactory.getLogger(AgentTaskCommandDispatcher.class);
    private static final int BATCH_SIZE = 20;
    private static final Set<String> ACCEPTED_STATUSES = Set.of("PENDING", "APPLIED");
    private final AgentTaskCommandOutbox outbox;
    private final AgentRunRepository runRepository;
    private final WorkspacePermissionReader permissionReader;
    private final DelegationTokenIssuer tokenIssuer;
    private final AgentRunClient client;
    private final AgentTaskRegistry registry;

    public AgentTaskCommandDispatcher(AgentTaskCommandOutbox outbox, AgentRunRepository runRepository, WorkspacePermissionReader permissionReader, DelegationTokenIssuer tokenIssuer, AgentRunClient client, AgentTaskRegistry registry) {
        this.outbox = outbox;
        this.runRepository = runRepository;
        this.permissionReader = permissionReader;
        this.tokenIssuer = tokenIssuer;
        this.client = client;
        this.registry = registry;
    }

    @Scheduled(fixedDelayString = "${agent.task-command-dispatch-delay-ms:250}")
    public void dispatchPending() {
        for (int index = 0; index < BATCH_SIZE; index++) {
            Optional<AgentTaskCommandOutbox.ClaimedCommand> claimed = outbox.claimNext();
            if (claimed.isEmpty()) return;
            if (!dispatch(claimed.get())) return;
        }
    }

    boolean dispatch(AgentTaskCommandOutbox.ClaimedCommand command) {
        AgentRunEntity run = runRepository.findByIdAndWorkspaceId(command.runId(), command.workspaceId()).orElse(null);
        MembershipPermissions membership = permissionReader.findActiveMembership(command.requestedBy(), command.workspaceId()).orElse(null);
        PermissionCode required = command.type() == AgentTaskCommandType.CANCEL ? PermissionCode.AGENT_CANCEL : PermissionCode.AGENT_RESPOND;
        if (run == null || membership == null || !membership.permissions().contains(required)) {
            outbox.fail(command.id(), command.deliveryAttempt(), "task command authority is no longer valid");
            return true;
        }
        List<String> permissions = membership.permissions().stream().map(PermissionCode::code)
            .sorted(Comparator.naturalOrder()).toList();
        String token = tokenIssuer.issue(run.id(), run.workspaceId(), run.projectId(), command.requestedBy(), permissions);
        InternalAgentTaskCommandRequest request = new InternalAgentTaskCommandRequest(command.id(), command.taskId(),
            command.runId(), command.workspaceId(), null, command.expectedTaskRevision(), command.type().name(), "PENDING",
            command.idempotencyKey(), command.requestedBy(), command.requestedAt(), command.payload(),
            command.authorizationRevision(), command.budgetRevision(), "async-task-contract-v1");
        try {
            InternalAgentTaskCommandResponse response = client.taskCommand(run.id(), request, token, traceparent());
            requireMatching(command, response);
            if (command.type() == AgentTaskCommandType.CANCEL && "APPLIED".equals(response.status())) {
                registry.acknowledgeCancellation(command.taskId(), command.workspaceId(),
                    command.expectedTaskRevision(), java.time.Instant.now());
            }
            outbox.delivered(command.id(), command.deliveryAttempt());
            return true;
        } catch (RuntimeException error) {
            if (isPermanent(error) || command.deliveryAttempt() >= 5) {
                outbox.fail(command.id(), command.deliveryAttempt(), errorMessage(error));
                return true;
            }
            outbox.retry(command.id(), command.deliveryAttempt(), retryDelay(command.deliveryAttempt()), errorMessage(error));
            log.warn("Task command delivery will be retried: commandId={} runId={} attempt={}",
                command.id(), command.runId(), command.deliveryAttempt());
            return false;
        }
    }

    private static void requireMatching(AgentTaskCommandOutbox.ClaimedCommand command, InternalAgentTaskCommandResponse response) {
        if (response == null || !command.id().equals(response.commandId()) || !command.taskId().equals(response.taskId())
            || response.taskRevision() != command.expectedTaskRevision() || !ACCEPTED_STATUSES.contains(response.status())
            || response.targetRevision() != (command.type() == AgentTaskCommandType.HARD_REDIRECT
                ? command.expectedTaskRevision() + 1 : command.expectedTaskRevision())) {
            throw new IllegalStateException("Agent Task command acknowledgement identity is invalid");
        }
    }

    private static boolean isPermanent(RuntimeException error) {
        if (!(error instanceof RestClientResponseException response)) return false;
        int status = response.getStatusCode().value();
        return status >= 400 && status < 500 && status != HttpStatus.REQUEST_TIMEOUT.value()
            && status != HttpStatus.TOO_MANY_REQUESTS.value();
    }

    private static Duration retryDelay(int attempt) {
        return Duration.ofSeconds(Math.min(30, 1L << Math.min(5, Math.max(0, attempt - 1))));
    }

    private static String errorMessage(RuntimeException error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message.substring(0, Math.min(500, message.length()));
    }

    private static String traceparent() {
        String traceId = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "");
        String spanId = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        return "00-" + traceId.substring(0, 32) + "-" + spanId + "-01";
    }
}
