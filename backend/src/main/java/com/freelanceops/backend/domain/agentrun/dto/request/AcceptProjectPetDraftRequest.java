package com.freelanceops.backend.domain.agentrun.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

@Schema(name = "Accept")
public record AcceptProjectPetDraftRequest(@NotNull UUID runId, @Min(0) long expectedVersion) {}
