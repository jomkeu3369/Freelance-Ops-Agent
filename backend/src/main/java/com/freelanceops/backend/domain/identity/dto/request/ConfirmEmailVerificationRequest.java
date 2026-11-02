package com.freelanceops.backend.domain.identity.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(name = "Confirmation")
public record ConfirmEmailVerificationRequest(
        @NotBlank @Size(max = 128) String token,
        @NotBlank @Size(min = 12, max = 72) String password) {
    @Override
    public String toString() {
        return "EmailVerificationConfirmation[redacted]";
    }
}
