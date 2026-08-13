package com.freelanceops.backend.domain.workspace.repository;

import com.freelanceops.backend.domain.workspace.policy.MembershipPermissions;

import java.util.Optional;
import java.util.UUID;

public interface WorkspacePermissionReader {

    Optional<MembershipPermissions> findActiveMembership(UUID userId, UUID workspaceId);
}


