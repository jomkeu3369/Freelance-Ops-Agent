package com.freelanceops.backend.domain.agentrun.dto.response;

import com.freelanceops.backend.domain.agentrun.model.Provider;

import io.swagger.v3.oas.annotations.media.Schema;

import java.math.BigDecimal;

@Schema(name = "ModelCap")
public record PlatformModelCapResponse(
        Provider provider, String model, BigDecimal maxRunUsd, boolean enabled) {}
