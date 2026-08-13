package com.freelanceops.backend.domain.workspace.entity;

import com.freelanceops.backend.domain.workspace.policy.AuthorizationAuditEvent;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "rbac_audit_event", schema = "app")
public class RbacAuditEventEntity {

    @Id
    private UUID id;

    @Column(name = "workspace_id")
    private UUID workspaceId;

    @Column(name = "actor_user_id")
    private UUID actorUserId;

    private String action;

    private String outcome;

    @Column(name = "permission_code")
    private String permissionCode;

    @Column(name = "target_type")
    private String targetType;

    @Column(name = "target_id")
    private UUID targetId;

    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> details;

    protected RbacAuditEventEntity() {
    }

    private RbacAuditEventEntity(
        UUID workspaceId,
        UUID actorUserId,
        String action,
        String outcome,
        String permissionCode,
        String targetType,
        UUID targetId,
        Map<String, Object> details
    ) {
        this.id = UUID.randomUUID();
        this.workspaceId = workspaceId;
        this.actorUserId = actorUserId;
        this.action = action;
        this.outcome = outcome;
        this.permissionCode = permissionCode;
        this.targetType = targetType;
        this.targetId = targetId;
        this.details = Map.copyOf(details);
    }

    public static RbacAuditEventEntity workspaceCreated(UUID workspaceId, UUID actorUserId) {
        return new RbacAuditEventEntity(
            workspaceId,
            actorUserId,
            "WORKSPACE_CREATED",
            "SUCCEEDED",
            null,
            "WORKSPACE",
            workspaceId,
            Map.of()
        );
    }

    public static RbacAuditEventEntity authorizationCheck(AuthorizationAuditEvent event) {
        Map<String, Object> details = event.resourceWorkspaceId() == null
            ? Map.of()
            : Map.of("resourceWorkspaceId", event.resourceWorkspaceId().toString());
        return new RbacAuditEventEntity(
            event.workspaceId(),
            event.actorUserId(),
            "AUTHORIZATION_CHECK",
            event.decision().name(),
            event.permission().code(),
            "WORKSPACE_RESOURCE",
            null,
            details
        );
    }
}


