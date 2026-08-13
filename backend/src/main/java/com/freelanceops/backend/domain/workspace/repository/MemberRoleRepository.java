package com.freelanceops.backend.domain.workspace.repository;

import com.freelanceops.backend.domain.workspace.entity.MemberRoleEntity;
import com.freelanceops.backend.domain.workspace.entity.MemberRoleId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface MemberRoleRepository extends JpaRepository<MemberRoleEntity, MemberRoleId> {

    List<MemberRoleEntity> findAllByWorkspaceIdAndIdMembershipId(UUID workspaceId, UUID membershipId);
}


