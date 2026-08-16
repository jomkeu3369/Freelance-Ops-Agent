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
    void allowsPublicRouteAndToolDecisionEvents() throws Exception {
        UUID runId = UUID.randomUUID();
        String routeData = objectMapper.writeValueAsString(Map.of(
            "eventId", 3,
            "runId", runId,
            "type", "route.selected",
            "occurredAt", Instant.now(),
            "data", Map.of("route", "REACT_AGENT", "model", "gpt-5.6-luna")
        ));
        String toolData = objectMapper.writeValueAsString(Map.of(
            "eventId", 4,
            "runId", runId,
            "type", "tool.completed",
            "occurredAt", Instant.now(),
            "data", Map.of("toolName", "get_project_context", "reason", "project context required")
        ));

        assertThat(relay.parse("3", "route.selected", routeData, runId, 2).type()).isEqualTo("route.selected");
        assertThat(relay.parse("4", "tool.completed", toolData, runId, 3).type()).isEqualTo("tool.completed");
    }

    @Test
    void allowsPartialCompletionWithoutExposingPrivateExecutionState() throws Exception {
        UUID runId = UUID.randomUUID();
        String data = objectMapper.writeValueAsString(Map.of(
            "eventId", 5,
            "runId", runId,
            "type", "run.partial",
            "occurredAt", Instant.now(),
            "data", Map.of("errorCode", "MODEL_CALL_BUDGET_EXCEEDED")
        ));

        var event = relay.parse("5", "run.partial", data, runId, 4);

        assertThat(event.type()).isEqualTo("run.partial");
        assertThat(event.data()).containsEntry("errorCode", "MODEL_CALL_BUDGET_EXCEEDED");
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
