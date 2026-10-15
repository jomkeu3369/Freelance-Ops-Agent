package com.freelanceops.backend.domain.workspace.policy;

import java.util.UUID;

public record AuthorizationAuditEvent(
        UUID workspaceId,
        UUID actorUserId,
        PermissionCode permission,
        AuthorizationDecision decision,
        UUID resourceWorkspaceId) {}
