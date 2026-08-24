package com.freelanceops.backend.domain.project.service;

import java.util.UUID;

public interface ProjectAgentCommandFence {
    void requireNoInFlightCommands(UUID workspaceId, UUID projectId);
}
