package com.freelanceops.backend.domain.identity.service;

import com.freelanceops.backend.domain.identity.entity.UserAccountEntity;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class AuthTokenServiceTest {

    private static final Instant NOW = Instant.now();

    @Test
    void issuesSignedAccessTokenAndOpaqueRefreshToken() {
        SecretKey key = key();
        AuthTokenService service = new AuthTokenService(
            NimbusJwtEncoder.withSecretKey(key).algorithm(MacAlgorithm.HS256).build(),
            "test-issuer",
            "test-audience",
            Duration.ofMinutes(15),
            Duration.ofDays(30),
            Clock.fixed(NOW, ZoneOffset.UTC),
            new SecureRandom()
        );
        UserAccountEntity user = UserAccountEntity.registerLocal(
            UUID.randomUUID(),
            "member@example.com",
            "Member",
            "encoded-password",
            NOW
        );

        AuthTokenService.IssuedAccessToken access = service.issueAccessToken(user);
        AuthTokenService.IssuedRefreshToken refresh = service.issueRefreshToken();

        JwtDecoder decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        Jwt jwt = decoder.decode(access.value());
        assertThat(jwt.getSubject()).isEqualTo(user.id().toString());
        assertThat(jwt.getAudience()).containsExactly("test-audience");
        assertThat(jwt.getClaimAsString("token_type")).isEqualTo("access");
        assertThat(access.expiresAt()).isEqualTo(NOW.plus(Duration.ofMinutes(15)));
        assertThat(refresh.value()).doesNotContain("=");
        assertThat(refresh.hash()).hasSize(64).isEqualTo(service.hash(refresh.value()));
        assertThat(refresh.expiresAt()).isEqualTo(NOW.plus(Duration.ofDays(30)));
    }

    private static SecretKey key() {
        return new SecretKeySpec(
            "test-auth-secret-with-at-least-32-bytes".getBytes(StandardCharsets.UTF_8),
            "HmacSHA256"
        );
    }
}
