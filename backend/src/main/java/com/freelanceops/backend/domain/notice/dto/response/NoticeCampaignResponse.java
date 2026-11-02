package com.freelanceops.backend.domain.notice.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Schema(name = "Campaign")
public record NoticeCampaignResponse(
        UUID id,
        UUID noticeId,
        String snapshotTitle,
        String snapshotBody,
        String snapshotVersionLabel,
        String status,
        String contentHash,
        String recipientHash,
        int recipientCount,
        String testStatus,
        Instant createdAt,
        Map<String, Integer> deliveries) {}
