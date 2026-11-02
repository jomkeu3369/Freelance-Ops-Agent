package com.freelanceops.backend.domain.agentrun.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.UUID;

@Schema(name = "Admission")
public record ByokExecutionAdmissionResponse(
        UUID callId,
        boolean admitted,
        Instant validUntil,
        String fundingSource,
        String serviceTier) {}
