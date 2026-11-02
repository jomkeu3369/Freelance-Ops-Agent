package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.Provider;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "ModelRate")
public record FreeUsageModelRateResponse(
        Provider provider, String model, int credits, boolean enabled) {}
