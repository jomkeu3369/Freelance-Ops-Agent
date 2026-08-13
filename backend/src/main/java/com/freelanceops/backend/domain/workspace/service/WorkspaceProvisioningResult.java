package com.freelanceops.backend.domain.workspace.service;

import java.util.UUID;

public record WorkspaceProvisioningResult(UUID workspaceId, UUID ownerMembershipId) {
}


