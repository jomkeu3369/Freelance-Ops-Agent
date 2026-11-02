package com.freelanceops.backend.domain.internaltool.dto.response;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "Credential")
public record InternalCredentialResponse(String apiKey) {
    @Override
    public String toString() {
        return "Credential[redacted]";
    }
}
