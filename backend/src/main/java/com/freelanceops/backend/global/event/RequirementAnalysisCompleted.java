package com.freelanceops.backend.global.event;

import java.util.UUID;

public record RequirementAnalysisCompleted(UUID runId, UUID workspaceId, UUID projectId, UUID initiatedBy, String summary, java.util.List<UUID> parentDocumentIds) {}
