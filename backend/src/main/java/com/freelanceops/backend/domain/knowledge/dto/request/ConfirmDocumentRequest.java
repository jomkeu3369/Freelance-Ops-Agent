package com.freelanceops.backend.domain.knowledge.dto.request;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record ConfirmDocumentRequest(@NotNull @Min(0) Long expectedVersion) {}
