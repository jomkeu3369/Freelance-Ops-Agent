package com.freelanceops.backend.domain.agentrun.model;

public enum AgentRunStatus {
    QUEUED,
    RUNNING,
    WAITING_FOR_USER,
    COMPLETED,
    PARTIAL,
    FAILED,
    CANCELLED
}
