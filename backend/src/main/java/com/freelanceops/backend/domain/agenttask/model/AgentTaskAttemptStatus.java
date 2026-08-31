package com.freelanceops.backend.domain.agenttask.model;

public enum AgentTaskAttemptStatus {
    QUEUED,
    LEASED,
    RUNNING,
    CHECKPOINTED,
    COMPLETED,
    FAILED,
    CANCELLED,
    TIMED_OUT,
    SUPERSEDED;

    public boolean terminal() {
        return this == COMPLETED || this == FAILED || this == CANCELLED || this == TIMED_OUT || this == SUPERSEDED;
    }
}
