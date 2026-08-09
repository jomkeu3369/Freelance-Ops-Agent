package com.freelanceops.backend.workspace.application;

import com.freelanceops.backend.workspace.domain.AuthorizationDecision;
import com.freelanceops.backend.workspace.domain.PermissionCode;

import java.util.UUID;

public record AuthorizationAuditEvent(
    UUID workspaceId,
    UUID actorUserId,
    PermissionCode permission,
    AuthorizationDecision decision,
    UUID resourceWorkspaceId
) {
}
