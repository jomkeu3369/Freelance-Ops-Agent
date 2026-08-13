package com.freelanceops.backend.domain.workspace.repository;

import com.freelanceops.backend.domain.workspace.entity.RolePermissionEntity;
import com.freelanceops.backend.domain.workspace.entity.RolePermissionId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface RolePermissionRepository extends JpaRepository<RolePermissionEntity, RolePermissionId> {

    List<RolePermissionEntity> findAllByWorkspaceIdAndIdRoleIdIn(UUID workspaceId, Collection<UUID> roleIds);
}


