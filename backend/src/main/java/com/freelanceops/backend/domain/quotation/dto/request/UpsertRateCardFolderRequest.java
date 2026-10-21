package com.freelanceops.backend.domain.quotation.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record UpsertRateCardFolderRequest(
        @NotBlank @Size(max = 120) String name, UUID parentId) {}
