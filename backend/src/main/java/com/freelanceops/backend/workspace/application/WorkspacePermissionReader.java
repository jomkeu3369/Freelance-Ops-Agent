package com.freelanceops.backend.workspace.application;

import com.freelanceops.backend.workspace.domain.MembershipPermissions;

import java.util.Optional;
import java.util.UUID;

public interface WorkspacePermissionReader {

    Optional<MembershipPermissions> findActiveMembership(UUID userId, UUID workspaceId);
}
