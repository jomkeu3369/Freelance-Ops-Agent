package com.freelanceops.backend.domain.agentrun.client;

import java.io.IOException;
import java.io.InputStream;

public record AgentEventStream(InputStream body) implements AutoCloseable {
    @Override
    public void close() throws IOException { body.close(); }
}
