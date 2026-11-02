package com.freelanceops.backend.domain.agentrun.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

@Schema(name = "History")
public record PlatformUsageHistoryResponse(
        List<PlatformUsageEntryResponse> items, String nextCursor) {}
