package com.freelanceops.backend.domain.notice.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

@Schema(name = "Confirmation")
public record ConfirmNoticeCampaignRequest(
        @NotBlank @Pattern(regexp = "[a-f0-9]{64}") String contentHash,
        @NotBlank @Pattern(regexp = "[a-f0-9]{64}") String recipientHash,
        @NotNull @Min(0) Integer recipientCount,
        @NotBlank String confirmation) {}
