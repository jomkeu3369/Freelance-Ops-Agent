package com.freelanceops.backend.domain.notice.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

@Schema(name = "Revision")
public record ReviewNoticeRequest(@NotNull @Min(0) Long expectedRevision) {}
