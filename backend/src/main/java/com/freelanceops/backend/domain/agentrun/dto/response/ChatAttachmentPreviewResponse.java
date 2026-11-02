package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.dto.AttachmentText;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.UUID;

@Schema(name = "Preview")
public record ChatAttachmentPreviewResponse(
        UUID id, Instant expiresAt, AttachmentText extraction) {}
