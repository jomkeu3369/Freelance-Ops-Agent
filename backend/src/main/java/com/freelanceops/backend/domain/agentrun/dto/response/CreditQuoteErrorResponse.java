package com.freelanceops.backend.domain.agentrun.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "QuoteError")
public record CreditQuoteErrorResponse(String code, String message) {}
