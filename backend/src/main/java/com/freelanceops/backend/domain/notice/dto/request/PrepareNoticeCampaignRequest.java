package com.freelanceops.backend.domain.notice.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

@Schema(name = "Preparation")
public record PrepareNoticeCampaignRequest(@NotNull UUID noticeId) {}
