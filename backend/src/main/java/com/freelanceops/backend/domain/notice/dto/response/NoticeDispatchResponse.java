package com.freelanceops.backend.domain.notice.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "Dispatch")
public record NoticeDispatchResponse(String status, int processed) {}
