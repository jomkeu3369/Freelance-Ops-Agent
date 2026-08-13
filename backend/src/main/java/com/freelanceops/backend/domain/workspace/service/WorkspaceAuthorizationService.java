package com.freelanceops.backend.domain.workspace.service;

import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationAuditEvent;
import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.AuthorizationAuditSink;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.UUID;

@Service
public class WorkspaceAuthorizationService {

    private final WorkspacePermissionReader permissionReader;
    private final AuthorizationAuditSink auditSink;

    public WorkspaceAuthorizationService(WorkspacePermissionReader permissionReader, AuthorizationAuditSink auditSink) {
        this.permissionReader = permissionReader;
        this.auditSink = auditSink;
    }

    public AuthorizationDecision authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        return authorize(userId, workspaceId, permission, null);
    }

    public AuthorizationDecision authorize(UUID userId, UUID workspaceId, PermissionCode permission,
                                           UUID resourceWorkspaceId) {
        Optional<MembershipPermissions> membership = permissionReader.findActiveMembership(userId, workspaceId);
        AuthorizationDecision decision = decide(membership, workspaceId, permission, resourceWorkspaceId);
        if (decision != AuthorizationDecision.ALLOWED) {
            auditSink.record(new AuthorizationAuditEvent(
                workspaceId,
                userId,
                permission,
                decision,
                resourceWorkspaceId
            ));
        }
        return decision;
    }

    private AuthorizationDecision decide(Optional<MembershipPermissions> membership, UUID workspaceId,
                                         PermissionCode permission, UUID resourceWorkspaceId) {
        if (membership.isEmpty()) {
            return AuthorizationDecision.NOT_FOUND;
        }
        if (resourceWorkspaceId != null && !workspaceId.equals(resourceWorkspaceId)) {
            return AuthorizationDecision.NOT_FOUND;
        }
        if (!membership.get().permissions().contains(permission)) {
            return AuthorizationDecision.FORBIDDEN;
        }
        return AuthorizationDecision.ALLOWED;
    }
}


