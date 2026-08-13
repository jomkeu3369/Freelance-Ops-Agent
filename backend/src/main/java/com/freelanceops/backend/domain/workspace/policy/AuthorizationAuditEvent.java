package com.freelanceops.backend.domain.workspace.policy;

import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;

import java.util.UUID;

public record AuthorizationAuditEvent(
    UUID workspaceId,
    UUID actorUserId,
    PermissionCode permission,
    AuthorizationDecision decision,
    UUID resourceWorkspaceId
) {
}


