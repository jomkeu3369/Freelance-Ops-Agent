package com.freelanceops.backend.workspace.infrastructure;

import com.freelanceops.backend.workspace.application.WorkspacePermissionReader;
import com.freelanceops.backend.workspace.domain.MembershipPermissions;
import com.freelanceops.backend.workspace.domain.PermissionCode;
import com.freelanceops.backend.workspace.infrastructure.persistence.MemberRoleEntity;
import com.freelanceops.backend.workspace.infrastructure.persistence.MemberRoleRepository;
import com.freelanceops.backend.workspace.infrastructure.persistence.RolePermissionEntity;
import com.freelanceops.backend.workspace.infrastructure.persistence.RolePermissionRepository;
import com.freelanceops.backend.workspace.infrastructure.persistence.WorkspaceMemberRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class JpaWorkspacePermissionReader implements WorkspacePermissionReader {

    private final WorkspaceMemberRepository workspaceMemberRepository;
    private final MemberRoleRepository memberRoleRepository;
    private final RolePermissionRepository rolePermissionRepository;

    public JpaWorkspacePermissionReader(
        WorkspaceMemberRepository workspaceMemberRepository,
        MemberRoleRepository memberRoleRepository,
        RolePermissionRepository rolePermissionRepository
    ) {
        this.workspaceMemberRepository = workspaceMemberRepository;
        this.memberRoleRepository = memberRoleRepository;
        this.rolePermissionRepository = rolePermissionRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<MembershipPermissions> findActiveMembership(UUID userId, UUID workspaceId) {
        return workspaceMemberRepository.findByUserIdAndWorkspaceIdAndStatus(userId, workspaceId, "ACTIVE")
            .map(membership -> new MembershipPermissions(
                membership.id(),
                findPermissions(workspaceId, membership.id())
            ));
    }

    private EnumSet<PermissionCode> findPermissions(UUID workspaceId, UUID membershipId) {
        List<UUID> roleIds = memberRoleRepository
            .findAllByWorkspaceIdAndIdMembershipId(workspaceId, membershipId)
            .stream()
            .map(MemberRoleEntity::roleId)
            .toList();
        EnumSet<PermissionCode> permissions = EnumSet.noneOf(PermissionCode.class);
        if (roleIds.isEmpty()) {
            return permissions;
        }
        rolePermissionRepository.findAllByWorkspaceIdAndIdRoleIdIn(workspaceId, roleIds)
            .stream()
            .map(RolePermissionEntity::permissionCode)
            .map(PermissionCode::fromCode)
            .forEach(permissions::add);
        return permissions;
    }
}
