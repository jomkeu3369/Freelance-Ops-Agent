package com.freelanceops.backend.workspace.infrastructure;

import com.freelanceops.backend.workspace.application.AuthorizationAuditEvent;
import com.freelanceops.backend.workspace.application.AuthorizationAuditSink;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public class JdbcAuthorizationAuditSink implements AuthorizationAuditSink {

    private final JdbcClient jdbcClient;

    public JdbcAuthorizationAuditSink(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    @Override
    public void record(AuthorizationAuditEvent event) {
        jdbcClient.sql("""
                INSERT INTO app.rbac_audit_event (
                    id,
                    workspace_id,
                    actor_user_id,
                    action,
                    outcome,
                    permission_code,
                    target_type,
                    details
                ) VALUES (
                    :id,
                    :workspaceId,
                    :actorUserId,
                    'AUTHORIZATION_CHECK',
                    :outcome,
                    :permissionCode,
                    'WORKSPACE_RESOURCE',
                    CAST(:details AS jsonb)
                )
                """)
            .param("id", UUID.randomUUID())
            .param("workspaceId", event.workspaceId())
            .param("actorUserId", event.actorUserId())
            .param("outcome", event.decision().name())
            .param("permissionCode", event.permission().code())
            .param("details", resourceDetails(event.resourceWorkspaceId()))
            .update();
    }

    private String resourceDetails(UUID resourceWorkspaceId) {
        if (resourceWorkspaceId == null) {
            return "{}";
        }
        return "{\"resourceWorkspaceId\":\"" + resourceWorkspaceId + "\"}";
    }
}
