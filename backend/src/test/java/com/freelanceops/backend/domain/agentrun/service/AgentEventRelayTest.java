package com.freelanceops.backend.domain.agentrun.service;

import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;
import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AgentEventRelayTest {
    private final ObjectMapper objectMapper = JsonMapper.builder().findAndAddModules().build();
    private final AgentEventRelay relay = new AgentEventRelay(objectMapper);

    @Test
    void validatesPublicEventEnvelopeAgainstPayload() throws Exception {
        UUID runId = UUID.randomUUID();
        String data = objectMapper.writeValueAsString(Map.of(
            "eventId", 2,
            "runId", runId,
            "type", "run.completed",
            "occurredAt", Instant.now(),
            "data", Map.of("status", "COMPLETED")
        ));

        var event = relay.parse("2", "run.completed", data, runId, 1);

        assertThat(event.eventId()).isEqualTo(2);
        assertThat(event.type()).isEqualTo("run.completed");
    }

    @Test
    void rejectsPrivateOrMismatchedEvents() {
        UUID runId = UUID.randomUUID();
        String data = "{\"eventId\":2,\"runId\":\"" + runId + "\",\"type\":\"internal.node\",\"occurredAt\":\"2026-08-13T00:00:00Z\",\"data\":{}}";

        assertThatThrownBy(() -> relay.parse("2", "internal.node", data, runId, 1))
            .isInstanceOf(IOException.class);
        assertThatThrownBy(() -> relay.parse("1", "run.completed", data, runId, 1))
            .isInstanceOf(IOException.class);
    }
}
