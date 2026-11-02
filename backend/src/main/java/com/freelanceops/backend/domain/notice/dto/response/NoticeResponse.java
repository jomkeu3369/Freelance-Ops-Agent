package com.freelanceops.backend.domain.notice.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.UUID;

@Schema(name = "Notice")
public record NoticeResponse(
        UUID id,
        String kind,
        String title,
        String body,
        String versionLabel,
        Instant effectiveAt,
        Instant publishAt,
        String status,
        String contentHash,
        long revision) {}
