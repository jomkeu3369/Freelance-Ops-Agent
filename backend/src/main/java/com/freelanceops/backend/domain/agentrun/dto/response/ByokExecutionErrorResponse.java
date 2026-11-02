package com.freelanceops.backend.domain.agentrun.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "Error")
public record ByokExecutionErrorResponse(String code, String message) {}
