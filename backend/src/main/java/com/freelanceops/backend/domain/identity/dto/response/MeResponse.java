package com.freelanceops.backend.domain.identity.dto.response;

import java.util.List;
import java.util.UUID;

public record MeResponse(
    UUID id,
    String email,
    String displayName,
    String status,
    List<WorkspaceAccessResponse> workspaces
) {
}
