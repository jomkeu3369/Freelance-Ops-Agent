package com.freelanceops.backend.workspace.application;

import com.freelanceops.backend.workspace.domain.SystemRole;
import com.freelanceops.backend.workspace.infrastructure.persistence.MemberRoleEntity;
import com.freelanceops.backend.workspace.infrastructure.persistence.MemberRoleRepository;
import com.freelanceops.backend.workspace.infrastructure.persistence.RbacAuditEventEntity;
import com.freelanceops.backend.workspace.infrastructure.persistence.RbacAuditEventRepository;
import com.freelanceops.backend.workspace.infrastructure.persistence.RolePermissionEntity;
import com.freelanceops.backend.workspace.infrastructure.persistence.RolePermissionRepository;
import com.freelanceops.backend.workspace.infrastructure.persistence.WorkspaceEntity;
import com.freelanceops.backend.workspace.infrastructure.persistence.WorkspaceMemberEntity;
import com.freelanceops.backend.workspace.infrastructure.persistence.WorkspaceMemberRepository;
import com.freelanceops.backend.workspace.infrastructure.persistence.WorkspaceRepository;
import com.freelanceops.backend.workspace.infrastructure.persistence.WorkspaceRoleEntity;
import com.freelanceops.backend.workspace.infrastructure.persistence.WorkspaceRoleRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class WorkspaceProvisioningService {

    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMemberRepository workspaceMemberRepository;
    private final WorkspaceRoleRepository workspaceRoleRepository;
    private final RolePermissionRepository rolePermissionRepository;
    private final MemberRoleRepository memberRoleRepository;
    private final RbacAuditEventRepository auditEventRepository;

    public WorkspaceProvisioningService(
        WorkspaceRepository workspaceRepository,
        WorkspaceMemberRepository workspaceMemberRepository,
        WorkspaceRoleRepository workspaceRoleRepository,
        RolePermissionRepository rolePermissionRepository,
        MemberRoleRepository memberRoleRepository,
        RbacAuditEventRepository auditEventRepository
    ) {
        this.workspaceRepository = workspaceRepository;
        this.workspaceMemberRepository = workspaceMemberRepository;
        this.workspaceRoleRepository = workspaceRoleRepository;
        this.rolePermissionRepository = rolePermissionRepository;
        this.memberRoleRepository = memberRoleRepository;
        this.auditEventRepository = auditEventRepository;
    }

    @Transactional
    public WorkspaceProvisioningResult create(UUID creatorUserId, String name, String slug) {
        UUID workspaceId = UUID.randomUUID();
        UUID membershipId = UUID.randomUUID();

        workspaceRepository.saveAndFlush(WorkspaceEntity.active(workspaceId, name, slug, creatorUserId));
        workspaceMemberRepository.saveAndFlush(
            WorkspaceMemberEntity.activeOwner(membershipId, workspaceId, creatorUserId)
        );
        Map<SystemRole, UUID> roleIds = createSystemRoles(workspaceId);
        memberRoleRepository.saveAndFlush(MemberRoleEntity.assign(
            workspaceId,
            membershipId,
            roleIds.get(SystemRole.OWNER),
            creatorUserId
        ));
        auditEventRepository.save(RbacAuditEventEntity.workspaceCreated(workspaceId, creatorUserId));

        return new WorkspaceProvisioningResult(workspaceId, membershipId);
    }

    private Map<SystemRole, UUID> createSystemRoles(UUID workspaceId) {
        Map<SystemRole, UUID> roleIds = new EnumMap<>(SystemRole.class);
        List<WorkspaceRoleEntity> roles = new ArrayList<>();
        List<RolePermissionEntity> rolePermissions = new ArrayList<>();

        for (SystemRole role : SystemRole.values()) {
            UUID roleId = UUID.randomUUID();
            roleIds.put(role, roleId);
            roles.add(WorkspaceRoleEntity.system(roleId, workspaceId, role));
            role.permissions().stream()
                .map(permission -> RolePermissionEntity.of(workspaceId, roleId, permission))
                .forEach(rolePermissions::add);
        }

        workspaceRoleRepository.saveAllAndFlush(roles);
        rolePermissionRepository.saveAllAndFlush(rolePermissions);
        return roleIds;
    }
}
