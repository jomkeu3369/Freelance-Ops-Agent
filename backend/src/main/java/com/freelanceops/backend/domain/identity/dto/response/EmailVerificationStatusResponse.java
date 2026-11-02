package com.freelanceops.backend.domain.identity.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "Status")
public record EmailVerificationStatusResponse(String status) {}
