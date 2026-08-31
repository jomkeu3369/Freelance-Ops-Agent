package com.freelanceops.backend.domain.agenttask.dto.request;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record IngestAgentTaskEventRequest(
    @NotBlank @Size(max = 128) String eventId,
    @NotNull UUID runId,
    @NotNull UUID workspaceId,
    @NotNull UUID taskId,
    @Min(1) int taskRevision,
    @NotNull UUID attemptId,
    @Min(1) int attemptNumber,
    @NotBlank @Size(max = 64) String schemaVersion,
    @NotBlank @Size(max = 64) String source,
    @NotBlank @Size(max = 128) String sourceEventId,
    @Min(1) int sequence,
    @NotBlank @Size(max = 64) String eventType,
    @Size(max = 100) String phase,
    @Size(max = 200) String milestone,
    @NotNull Map<String, Object> data,
    @NotNull Instant occurredAt
) {
}
