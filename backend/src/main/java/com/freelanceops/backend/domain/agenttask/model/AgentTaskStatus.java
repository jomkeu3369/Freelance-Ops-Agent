package com.freelanceops.backend.domain.agenttask.model;

public enum AgentTaskStatus {
    QUEUED,
    DISPATCHED,
    RUNNING,
    WAITING_FOR_TOOL,
    WAITING_FOR_USER,
    UPDATE_PENDING,
    CANCELLING,
    CANCELLED,
    COMPLETED,
    COMPLETED_REUSED,
    FAILED,
    TIMED_OUT;

    public boolean terminal() {
        return this == CANCELLED || this == COMPLETED || this == COMPLETED_REUSED || this == FAILED || this == TIMED_OUT;
    }
}
