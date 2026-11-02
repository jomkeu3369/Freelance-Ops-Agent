package com.freelanceops.backend.domain.notice.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;

@Schema(name = "Draft")
public record CreateNoticeRequest(
        @NotBlank @Size(max = 24) String kind,
        @NotBlank @Size(max = 200) String title,
        @NotNull @Size(max = 20000) String body,
        @NotBlank @Size(max = 80) String versionLabel,
        @NotNull Instant effectiveAt) {}
