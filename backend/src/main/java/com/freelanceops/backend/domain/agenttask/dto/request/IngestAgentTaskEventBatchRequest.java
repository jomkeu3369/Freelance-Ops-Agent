package com.freelanceops.backend.domain.agenttask.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

public record IngestAgentTaskEventBatchRequest(
    @NotEmpty @Size(max = 100) List<@Valid IngestAgentTaskEventRequest> events
) {
}
