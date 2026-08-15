package com.freelanceops.backend.domain.project.service;

import java.util.UUID;

public interface ActiveProjectRunReader {

    boolean exists(UUID workspaceId, UUID projectId);
}
