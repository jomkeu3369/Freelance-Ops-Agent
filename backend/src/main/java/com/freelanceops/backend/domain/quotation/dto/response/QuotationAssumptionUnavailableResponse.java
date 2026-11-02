package com.freelanceops.backend.domain.quotation.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "Unavailable")
public record QuotationAssumptionUnavailableResponse(String code, String message) {}
