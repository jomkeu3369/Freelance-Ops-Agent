package com.freelanceops.backend.workspace.infrastructure.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface MemberRoleRepository extends JpaRepository<MemberRoleEntity, MemberRoleId> {

    List<MemberRoleEntity> findAllByWorkspaceIdAndIdMembershipId(UUID workspaceId, UUID membershipId);
}
