package com.freelanceops.backend.domain.agentrun.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "SpendError")
public record PlatformSpendErrorResponse(String code, String message) {}
