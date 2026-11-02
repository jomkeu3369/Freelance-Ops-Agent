package com.freelanceops.backend.domain.notice.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;

@Schema(name = "Publication")
public record PublishNoticeRequest(
        @NotNull @Min(0) Long expectedRevision,
        @NotNull Instant publishAt,
        @NotBlank String confirmation) {}
