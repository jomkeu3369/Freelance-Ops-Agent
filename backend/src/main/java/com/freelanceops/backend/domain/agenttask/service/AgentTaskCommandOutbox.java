package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskCommandDeliveryEntity;
import com.freelanceops.backend.domain.agenttask.entity.AgentTaskCommandEntity;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskCommandDeliveryStatus;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskCommandType;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskCommandDeliveryRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskCommandRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class AgentTaskCommandOutbox {

    private static final Duration LEASE = Duration.ofMinutes(2);
    private static final List<AgentTaskCommandDeliveryStatus> CLAIMABLE = List.of(
        AgentTaskCommandDeliveryStatus.PENDING, AgentTaskCommandDeliveryStatus.PROCESSING
    );
    private final AgentTaskCommandRepository commandRepository;
    private final AgentTaskCommandDeliveryRepository deliveryRepository;

    public AgentTaskCommandOutbox(AgentTaskCommandRepository commandRepository,
                                  AgentTaskCommandDeliveryRepository deliveryRepository) {
        this.commandRepository = commandRepository;
        this.deliveryRepository = deliveryRepository;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public UUID enqueue(UUID workspaceId, UUID runId, UUID taskId, int expectedRevision,
                        AgentTaskCommandType type, String idempotencyKey, Map<String, Object> payload,
                        UUID requestedBy, long authorizationRevision, long budgetRevision, Instant now) {
        return enqueueWithResult(workspaceId, runId, taskId, expectedRevision, type, idempotencyKey, payload,
            requestedBy, authorizationRevision, budgetRevision, now).commandId();
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public EnqueueResult enqueueWithResult(UUID workspaceId, UUID runId, UUID taskId, int expectedRevision,
                                           AgentTaskCommandType type, String idempotencyKey,
                                           Map<String, Object> payload, UUID requestedBy,
                                           long authorizationRevision, long budgetRevision, Instant now) {
        Optional<AgentTaskCommandEntity> existing = commandRepository
            .findByWorkspaceIdAndTaskIdAndIdempotencyKey(workspaceId, taskId, idempotencyKey);
        if (existing.isPresent()) {
            if (matches(existing.get(), runId, expectedRevision, type, payload, requestedBy,
                authorizationRevision, budgetRevision)) return new EnqueueResult(existing.get().id(), false);
            throw new IllegalStateException("task command idempotency key conflicts with different data");
        }
        AgentTaskCommandEntity command = new AgentTaskCommandEntity(UUID.randomUUID(), workspaceId, runId, taskId,
            expectedRevision, type, idempotencyKey, payload, requestedBy, authorizationRevision, budgetRevision, now);
        commandRepository.saveAndFlush(command);
        deliveryRepository.saveAndFlush(new AgentTaskCommandDeliveryEntity(command.id(), now));
        return new EnqueueResult(command.id(), true);
    }

    @Transactional
    public Optional<ClaimedCommand> claimNext() {
        Instant now = Instant.now();
        return deliveryRepository.findClaimableForUpdate(CLAIMABLE, now, PageRequest.of(0, 1)).stream()
            .findFirst().map(delivery -> claim(delivery, now));
    }

    @Transactional
    public boolean delivered(UUID commandId, int claimedAttempt) {
        return deliveryRepository.findByIdForUpdate(commandId)
            .map(delivery -> delivery.delivered(claimedAttempt, Instant.now())).orElse(false);
    }

    @Transactional
    public boolean retry(UUID commandId, int claimedAttempt, Duration delay, String error) {
        if (delay.isNegative()) throw new IllegalArgumentException("retry delay must not be negative");
        Instant now = Instant.now();
        return deliveryRepository.findByIdForUpdate(commandId)
            .map(delivery -> delivery.retry(claimedAttempt, now.plus(delay), error, now)).orElse(false);
    }

    @Transactional
    public boolean fail(UUID commandId, int claimedAttempt, String error) {
        return deliveryRepository.findByIdForUpdate(commandId)
            .map(delivery -> delivery.fail(claimedAttempt, error, Instant.now())).orElse(false);
    }

    private ClaimedCommand claim(AgentTaskCommandDeliveryEntity delivery, Instant now) {
        delivery.claim(now, LEASE);
        AgentTaskCommandEntity command = commandRepository.findById(delivery.commandId())
            .orElseThrow(() -> new IllegalStateException("task command delivery has no immutable command"));
        return new ClaimedCommand(command.id(), command.workspaceId(), command.runId(), command.taskId(),
            command.expectedTaskRevision(), command.commandType(), command.idempotencyKey(), command.payload(),
            command.requestedBy(), command.requestedAt(), command.authorizationRevision(), command.budgetRevision(),
            delivery.attempts());
    }

    private static boolean matches(AgentTaskCommandEntity command, UUID runId, int expectedRevision,
                                   AgentTaskCommandType type, Map<String, Object> payload, UUID requestedBy,
                                   long authorizationRevision, long budgetRevision) {
        return command.runId().equals(runId) && command.expectedTaskRevision() == expectedRevision
            && command.commandType() == type && command.payload().equals(payload)
            && command.requestedBy().equals(requestedBy)
            && command.authorizationRevision() == authorizationRevision
            && command.budgetRevision() == budgetRevision;
    }

    public record ClaimedCommand(UUID id, UUID workspaceId, UUID runId, UUID taskId, int expectedTaskRevision,
                                 AgentTaskCommandType type, String idempotencyKey, Map<String, Object> payload,
                                 UUID requestedBy, Instant requestedAt, long authorizationRevision,
                                 long budgetRevision, int deliveryAttempt) {
        public ClaimedCommand {
            payload = Map.copyOf(payload);
        }
    }

    public record EnqueueResult(UUID commandId, boolean created) {
    }
}
