package com.freelanceops.backend.domain.workspace.repository;

import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.entity.MemberRoleEntity;
import com.freelanceops.backend.domain.workspace.repository.MemberRoleRepository;
import com.freelanceops.backend.domain.workspace.entity.RolePermissionEntity;
import com.freelanceops.backend.domain.workspace.repository.RolePermissionRepository;
import com.freelanceops.backend.domain.workspace.entity.WorkspaceMemberEntity;
import com.freelanceops.backend.domain.workspace.repository.WorkspaceMemberRepository;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class JpaWorkspacePermissionReaderTest {

    private final WorkspaceMemberRepository workspaceMemberRepository = mock(WorkspaceMemberRepository.class);
    private final MemberRoleRepository memberRoleRepository = mock(MemberRoleRepository.class);
    private final RolePermissionRepository rolePermissionRepository = mock(RolePermissionRepository.class);
    private final JpaWorkspacePermissionReader reader = new JpaWorkspacePermissionReader(
        workspaceMemberRepository,
        memberRoleRepository,
        rolePermissionRepository
    );

    @Test
    void combinesPermissionsOnlyInsideRequestedWorkspace() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID membershipId = UUID.randomUUID();
        UUID roleId = UUID.randomUUID();
        WorkspaceMemberEntity membership = WorkspaceMemberEntity.activeOwner(membershipId, workspaceId, userId);
        MemberRoleEntity memberRole = MemberRoleEntity.assign(workspaceId, membershipId, roleId, userId);

        when(workspaceMemberRepository.findByUserIdAndWorkspaceIdAndStatus(userId, workspaceId, "ACTIVE"))
            .thenReturn(Optional.of(membership));
        when(memberRoleRepository.findAllByWorkspaceIdAndIdMembershipId(workspaceId, membershipId))
            .thenReturn(List.of(memberRole));
        when(rolePermissionRepository.findAllByWorkspaceIdAndIdRoleIdIn(workspaceId, List.of(roleId)))
            .thenReturn(List.of(
                RolePermissionEntity.of(workspaceId, roleId, PermissionCode.PROJECT_READ),
                RolePermissionEntity.of(workspaceId, roleId, PermissionCode.PROJECT_WRITE)
            ));

        assertThat(reader.findActiveMembership(userId, workspaceId))
            .get()
            .extracting(result -> result.permissions())
            .isEqualTo(java.util.Set.of(PermissionCode.PROJECT_READ, PermissionCode.PROJECT_WRITE));
        verify(memberRoleRepository).findAllByWorkspaceIdAndIdMembershipId(workspaceId, membershipId);
        verify(rolePermissionRepository).findAllByWorkspaceIdAndIdRoleIdIn(workspaceId, List.of(roleId));
    }

    @Test
    void returnsEmptyWithoutActiveWorkspaceMembership() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(workspaceMemberRepository.findByUserIdAndWorkspaceIdAndStatus(userId, workspaceId, "ACTIVE"))
            .thenReturn(Optional.empty());

        assertThat(reader.findActiveMembership(userId, workspaceId)).isEmpty();
        verifyNoInteractions(memberRoleRepository, rolePermissionRepository);
    }
}


