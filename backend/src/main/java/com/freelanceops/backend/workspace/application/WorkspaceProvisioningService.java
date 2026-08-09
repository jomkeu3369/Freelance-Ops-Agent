package com.freelanceops.backend.workspace.application;

import com.freelanceops.backend.workspace.domain.PermissionCode;
import com.freelanceops.backend.workspace.domain.SystemRole;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;

@Service
public class WorkspaceProvisioningService {

    private final JdbcClient jdbcClient;

    public WorkspaceProvisioningService(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    @Transactional
    public WorkspaceProvisioningResult create(UUID creatorUserId, String name, String slug) {
        UUID workspaceId = UUID.randomUUID();
        UUID membershipId = UUID.randomUUID();

        insertWorkspace(workspaceId, creatorUserId, name, slug);
        insertOwnerMembership(membershipId, workspaceId, creatorUserId);
        Map<SystemRole, UUID> roleIds = insertSystemRoles(workspaceId);
        assignOwner(workspaceId, membershipId, roleIds.get(SystemRole.OWNER), creatorUserId);
        recordCreation(workspaceId, creatorUserId);

        return new WorkspaceProvisioningResult(workspaceId, membershipId);
    }

    private void insertWorkspace(UUID workspaceId, UUID creatorUserId, String name, String slug) {
        jdbcClient.sql("""
                INSERT INTO app.workspace (id, name, slug, status, created_by)
                VALUES (:id, :name, :slug, 'ACTIVE', :createdBy)
                """)
            .param("id", workspaceId)
            .param("name", name)
            .param("slug", slug)
            .param("createdBy", creatorUserId)
            .update();
    }

    private void insertOwnerMembership(UUID membershipId, UUID workspaceId, UUID creatorUserId) {
        jdbcClient.sql("""
                INSERT INTO app.workspace_member (id, workspace_id, user_id, status, joined_at)
                VALUES (:id, :workspaceId, :userId, 'ACTIVE', CURRENT_TIMESTAMP)
                """)
            .param("id", membershipId)
            .param("workspaceId", workspaceId)
            .param("userId", creatorUserId)
            .update();
    }

    private Map<SystemRole, UUID> insertSystemRoles(UUID workspaceId) {
        Map<SystemRole, UUID> roleIds = new EnumMap<>(SystemRole.class);
        for (SystemRole role : SystemRole.values()) {
            UUID roleId = UUID.randomUUID();
            insertRole(workspaceId, roleId, role);
            role.permissions().forEach(permission -> insertRolePermission(workspaceId, roleId, permission));
            roleIds.put(role, roleId);
        }
        return roleIds;
    }

    private void insertRole(UUID workspaceId, UUID roleId, SystemRole role) {
        jdbcClient.sql("""
                INSERT INTO app.workspace_role (id, workspace_id, code, display_name, system_role)
                VALUES (:id, :workspaceId, :code, :displayName, TRUE)
                """)
            .param("id", roleId)
            .param("workspaceId", workspaceId)
            .param("code", role.name())
            .param("displayName", role.name())
            .update();
    }

    private void insertRolePermission(UUID workspaceId, UUID roleId, PermissionCode permission) {
        jdbcClient.sql("""
                INSERT INTO app.role_permission (workspace_id, role_id, permission_code)
                VALUES (:workspaceId, :roleId, :permissionCode)
                """)
            .param("workspaceId", workspaceId)
            .param("roleId", roleId)
            .param("permissionCode", permission.code())
            .update();
    }

    private void assignOwner(UUID workspaceId, UUID membershipId, UUID ownerRoleId, UUID creatorUserId) {
        jdbcClient.sql("""
                INSERT INTO app.member_role (workspace_id, membership_id, role_id, assigned_by)
                VALUES (:workspaceId, :membershipId, :roleId, :assignedBy)
                """)
            .param("workspaceId", workspaceId)
            .param("membershipId", membershipId)
            .param("roleId", ownerRoleId)
            .param("assignedBy", creatorUserId)
            .update();
    }

    private void recordCreation(UUID workspaceId, UUID creatorUserId) {
        jdbcClient.sql("""
                INSERT INTO app.rbac_audit_event (
                    id,
                    workspace_id,
                    actor_user_id,
                    action,
                    outcome,
                    target_type,
                    target_id
                ) VALUES (
                    :id,
                    :workspaceId,
                    :actorUserId,
                    'WORKSPACE_CREATED',
                    'SUCCEEDED',
                    'WORKSPACE',
                    :workspaceId
                )
                """)
            .param("id", UUID.randomUUID())
            .param("workspaceId", workspaceId)
            .param("actorUserId", creatorUserId)
            .update();
    }
}
