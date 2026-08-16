package com.freelanceops.backend.domain.agentrun.service;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import com.freelanceops.backend.domain.agentrun.client.AgentEventStream;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunEvent;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;

@Component
public class AgentEventRelay {
    private static final int MAX_EVENT_DATA_LENGTH = 262_144;
    private static final Set<String> ALLOWED_EVENT_TYPES = Set.of(
        "run.accepted", "run.started", "run.completed", "run.partial", "run.failed", "run.cancelled",
        "clarification.requested", "clarification.responded", "route.selected", "tool.completed"
    );
    private final ObjectMapper objectMapper;

    public AgentEventRelay(ObjectMapper objectMapper) { this.objectMapper = objectMapper; }

    public void relay(AgentEventStream stream, UUID expectedRunId, long afterEventId, SseEmitter emitter) {
        try (stream; BufferedReader reader = new BufferedReader(new InputStreamReader(stream.body(), StandardCharsets.UTF_8))) {
            String id = null;
            String type = null;
            StringBuilder data = new StringBuilder();
            String line;
            long cursor = afterEventId;
            while ((line = reader.readLine()) != null) {
                if (line.isEmpty()) {
                    if (data.length() > 0) {
                        AgentRunEvent event = parse(id, type, data.toString(), expectedRunId, cursor);
                        cursor = event.eventId();
                        emitter.send(SseEmitter.event().id(Long.toString(event.eventId())).name(event.type()).data(event));
                    }
                    id = null; type = null; data.setLength(0);
                } else if (line.startsWith("id:")) {
                    id = line.substring(3).trim();
                } else if (line.startsWith("event:")) {
                    type = line.substring(6).trim();
                } else if (line.startsWith("data:")) {
                    if (data.length() > 0) data.append('\n');
                    data.append(line.substring(5).trim());
                    if (data.length() > MAX_EVENT_DATA_LENGTH) throw new IOException("agent event data exceeds relay limit");
                }
            }
            emitter.complete();
        } catch (Exception error) {
            emitter.completeWithError(error);
        }
    }

    AgentRunEvent parse(String id, String type, String data, UUID expectedRunId, long afterEventId) throws IOException {
        if (id == null || type == null || !ALLOWED_EVENT_TYPES.contains(type)) {
            throw new IOException("agent event envelope is invalid");
        }
        long eventId;
        try { eventId = Long.parseLong(id); }
        catch (NumberFormatException error) { throw new IOException("agent event id is invalid", error); }
        if (eventId <= afterEventId) throw new IOException("agent event id is not increasing");
        try {
            AgentRunEvent event = objectMapper.readValue(data, AgentRunEvent.class);
            if (event.eventId() != eventId || !expectedRunId.equals(event.runId()) || !type.equals(event.type())) {
                throw new IOException("agent event payload does not match its envelope");
            }
            return event;
        } catch (JacksonException error) {
            throw new IOException("agent event payload is invalid", error);
        }
    }
}
