package com.freelanceops.backend.domain.notice.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

@Schema(name = "Dashboard")
public record NoticeDashboardResponse(
        List<NoticeResponse> notices,
        List<NoticeCampaignResponse> campaigns,
        boolean transportReady) {}
