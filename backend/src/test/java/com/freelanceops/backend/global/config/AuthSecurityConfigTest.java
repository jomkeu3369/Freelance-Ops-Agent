package com.freelanceops.backend.global.config;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwtException;

import javax.crypto.SecretKey;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AuthSecurityConfigTest {

    private final AuthSecurityConfig config = new AuthSecurityConfig();

    @Test
    void refusesWeakOrDefaultProductionSecrets() {
        assertThatThrownBy(() -> config.authJwtSecretKey("too-short", "development"))
            .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> config.authJwtSecretKey(AuthSecurityConfig.DEVELOPMENT_SECRET, "production"))
            .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void decoderRequiresIssuerAudienceAndAccessTokenType() {
        SecretKey key = config.authJwtSecretKey("production-grade-auth-secret-value-12345", "test");
        JwtEncoder encoder = config.authJwtEncoder(key);
        JwtDecoder decoder = config.authJwtDecoder(key, "expected-issuer", "web-client");

        String accessToken = encode(encoder, "expected-issuer", "web-client", "access");
        assertThat(decoder.decode(accessToken).getSubject()).isEqualTo("00000000-0000-0000-0000-000000000001");

        assertThatThrownBy(() -> decoder.decode(encode(encoder, "expected-issuer", "other-client", "access")))
            .isInstanceOf(JwtException.class);
        assertThatThrownBy(() -> decoder.decode(encode(encoder, "expected-issuer", "web-client", "refresh")))
            .isInstanceOf(JwtException.class);
    }

    private static String encode(JwtEncoder encoder, String issuer, String audience, String tokenType) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer(issuer)
            .subject("00000000-0000-0000-0000-000000000001")
            .audience(List.of(audience))
            .issuedAt(now)
            .expiresAt(now.plusSeconds(60))
            .claim("token_type", tokenType)
            .build();
        return encoder.encode(JwtEncoderParameters.from(
            JwsHeader.with(MacAlgorithm.HS256).type("JWT").build(),
            claims
        )).getTokenValue();
    }
}
