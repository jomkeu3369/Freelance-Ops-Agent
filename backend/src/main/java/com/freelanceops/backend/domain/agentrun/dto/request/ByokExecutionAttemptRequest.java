package com.freelanceops.backend.domain.agentrun.dto.request;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

@Schema(name = "Attempt")
public record ByokExecutionAttemptRequest(
        @NotNull UUID callId,
        @NotNull UUID credentialId,
        @NotNull Provider provider,
        @NotNull String model,
        @NotNull ReasoningEffort reasoningEffort,
        @NotNull String fundingSource,
        @NotNull String serviceTier,
        @NotNull String operation,
        @Min(1) int inputTokens,
        @Min(1) int maxOutputTokens) {}
