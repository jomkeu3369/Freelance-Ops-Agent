package com.freelanceops.backend.domain.project.service;

import java.util.UUID;

public interface ProjectAgentRunCleanup {
    void cancelActiveRuns(UUID userId, UUID workspaceId, UUID projectId, String traceparent);
}
