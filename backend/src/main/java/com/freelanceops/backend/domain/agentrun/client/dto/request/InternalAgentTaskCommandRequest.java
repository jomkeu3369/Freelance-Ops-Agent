package com.freelanceops.backend.domain.agentrun.client.dto.request;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record InternalAgentTaskCommandRequest(UUID commandId, UUID taskId, UUID runId, UUID workspaceId,
                                              UUID attemptId, int expectedRevision, String type,
                                              String status, String idempotencyKey, UUID requestedBy,
                                              Instant requestedAt, Map<String, Object> payload,
                                              long authorizationRevision, long budgetRevision,
                                              String schemaVersion) {
}
