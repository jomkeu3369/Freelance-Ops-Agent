package com.freelanceops.backend.workspace.infrastructure;

import com.freelanceops.backend.workspace.application.WorkspacePermissionReader;
import com.freelanceops.backend.workspace.domain.MembershipPermissions;
import com.freelanceops.backend.workspace.domain.PermissionCode;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class JdbcWorkspacePermissionReader implements WorkspacePermissionReader {

    private final JdbcClient jdbcClient;

    public JdbcWorkspacePermissionReader(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    @Override
    public Optional<MembershipPermissions> findActiveMembership(UUID userId, UUID workspaceId) {
        Optional<UUID> membershipId = jdbcClient.sql("""
                SELECT id
                FROM app.workspace_member
                WHERE user_id = :userId
                  AND workspace_id = :workspaceId
                  AND status = 'ACTIVE'
                """)
            .param("userId", userId)
            .param("workspaceId", workspaceId)
            .query(UUID.class)
            .optional();

        if (membershipId.isEmpty()) {
            return Optional.empty();
        }

        List<String> codes = jdbcClient.sql("""
                SELECT DISTINCT rp.permission_code
                FROM app.member_role mr
                JOIN app.role_permission rp
                  ON rp.workspace_id = mr.workspace_id
                 AND rp.role_id = mr.role_id
                WHERE mr.workspace_id = :workspaceId
                  AND mr.membership_id = :membershipId
                """)
            .param("workspaceId", workspaceId)
            .param("membershipId", membershipId.get())
            .query(String.class)
            .list();

        EnumSet<PermissionCode> permissions = EnumSet.noneOf(PermissionCode.class);
        codes.stream().map(PermissionCode::fromCode).forEach(permissions::add);
        return Optional.of(new MembershipPermissions(membershipId.get(), permissions));
    }
}
