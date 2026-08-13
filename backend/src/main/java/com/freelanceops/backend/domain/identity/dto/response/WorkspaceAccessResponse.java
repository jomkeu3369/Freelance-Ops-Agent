package com.freelanceops.backend.domain.identity.dto.response;

import java.util.List;
import java.util.UUID;

public record WorkspaceAccessResponse(
    UUID workspaceId,
    String name,
    String slug,
    List<String> effectivePermissions
) {
}
