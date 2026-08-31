package com.freelanceops.backend.domain.agenttask.service;

import com.freelanceops.backend.domain.agenttask.entity.AgentTaskCommandEntity;
import com.freelanceops.backend.domain.agenttask.model.AgentTaskCommandType;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskCommandDeliveryRepository;
import com.freelanceops.backend.domain.agenttask.repository.AgentTaskCommandRepository;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AgentTaskCommandOutboxTest {

    private final AgentTaskCommandRepository commands = mock(AgentTaskCommandRepository.class);
    private final AgentTaskCommandDeliveryRepository deliveries = mock(AgentTaskCommandDeliveryRepository.class);
    private final AgentTaskCommandOutbox outbox = new AgentTaskCommandOutbox(commands, deliveries);

    @Test
    void exactIdempotentRequestReturnsExistingCommandWithoutAnotherDelivery() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID taskId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        AgentTaskCommandEntity existing = new AgentTaskCommandEntity(UUID.randomUUID(), workspaceId, runId, taskId,
            1, AgentTaskCommandType.SOFT_UPDATE, "update-1", Map.of("message", "continue"), userId, 2, 3, now);
        when(commands.findByWorkspaceIdAndTaskIdAndIdempotencyKey(workspaceId, taskId, "update-1"))
            .thenReturn(Optional.of(existing));

        UUID commandId = outbox.enqueue(workspaceId, runId, taskId, 1, AgentTaskCommandType.SOFT_UPDATE,
            "update-1", Map.of("message", "continue"), userId, 2, 3, now.plusSeconds(1));

        assertThat(commandId).isEqualTo(existing.id());
        verify(commands, never()).saveAndFlush(any());
        verify(deliveries, never()).saveAndFlush(any());
    }

    @Test
    void changedRequestWithSameIdempotencyKeyIsRejected() {
        Instant now = Instant.parse("2026-08-31T00:00:00Z");
        UUID workspaceId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID taskId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        AgentTaskCommandEntity existing = new AgentTaskCommandEntity(UUID.randomUUID(), workspaceId, runId, taskId,
            1, AgentTaskCommandType.SOFT_UPDATE, "update-1", Map.of("message", "first"), userId, 2, 3, now);
        when(commands.findByWorkspaceIdAndTaskIdAndIdempotencyKey(workspaceId, taskId, "update-1"))
            .thenReturn(Optional.of(existing));

        assertThatThrownBy(() -> outbox.enqueue(workspaceId, runId, taskId, 1, AgentTaskCommandType.SOFT_UPDATE,
            "update-1", Map.of("message", "changed"), userId, 2, 3, now.plusSeconds(1)))
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("idempotency");
    }
}
