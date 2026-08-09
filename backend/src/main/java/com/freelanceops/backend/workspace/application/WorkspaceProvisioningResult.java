package com.freelanceops.backend.workspace.application;

import java.util.UUID;

public record WorkspaceProvisioningResult(UUID workspaceId, UUID ownerMembershipId) {
}
