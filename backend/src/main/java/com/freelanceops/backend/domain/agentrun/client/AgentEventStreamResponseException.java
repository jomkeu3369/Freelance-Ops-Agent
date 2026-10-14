package com.freelanceops.backend.domain.agentrun.client;

/** Preserve an upstream status without retaining a private Agent response body. */
public final class AgentEventStreamResponseException extends IllegalStateException {
    private final int statusCode;

    public AgentEventStreamResponseException(int statusCode) {
        super("agent event stream returned status " + statusCode);
        this.statusCode = statusCode;
    }

    public int statusCode() { return statusCode; }
}
