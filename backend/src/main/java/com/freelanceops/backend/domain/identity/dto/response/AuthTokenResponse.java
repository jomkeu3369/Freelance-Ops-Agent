package com.freelanceops.backend.domain.identity.dto.response;

import java.time.Instant;
import java.util.UUID;

public record AuthTokenResponse(
    UUID userId,
    UUID workspaceId,
    String accessToken,
    Instant accessTokenExpiresAt,
    String refreshToken,
    Instant refreshTokenExpiresAt,
    String tokenType
) {
}
