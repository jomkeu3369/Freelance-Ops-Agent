package com.freelanceops.backend.domain.identity.service;

import com.freelanceops.backend.domain.identity.entity.UserAccountEntity;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

@Component
public class AuthTokenService {

    private final JwtEncoder encoder;
    private final String issuer;
    private final String audience;
    private final Duration accessLifetime;
    private final Duration refreshLifetime;
    private final Clock clock;
    private final SecureRandom secureRandom;

    @Autowired
    public AuthTokenService(
        JwtEncoder encoder,
        @Value("${app.auth.issuer:freelance-ops-backend}") String issuer,
        @Value("${app.auth.audience:freelance-ops-web}") String audience,
        @Value("${app.auth.access-token-ttl-seconds:900}") long accessTtlSeconds,
        @Value("${app.auth.refresh-token-ttl-seconds:2592000}") long refreshTtlSeconds
    ) {
        this(encoder, issuer, audience, Duration.ofSeconds(accessTtlSeconds), Duration.ofSeconds(refreshTtlSeconds), Clock.systemUTC(), new SecureRandom());
    }

    AuthTokenService(JwtEncoder encoder, String issuer, String audience, Duration accessLifetime, Duration refreshLifetime, Clock clock, SecureRandom secureRandom) {
        if (accessLifetime.isNegative() || accessLifetime.isZero() || refreshLifetime.compareTo(accessLifetime) <= 0) {
            throw new IllegalArgumentException("refresh lifetime must be greater than a positive access lifetime");
        }
        this.encoder = encoder;
        this.issuer = issuer;
        this.audience = audience;
        this.accessLifetime = accessLifetime;
        this.refreshLifetime = refreshLifetime;
        this.clock = clock;
        this.secureRandom = secureRandom;
    }

    public IssuedAccessToken issueAccessToken(UserAccountEntity user) {
        Instant issuedAt = clock.instant();
        Instant expiresAt = issuedAt.plus(accessLifetime);
        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer(issuer)
            .subject(user.id().toString())
            .audience(List.of(audience))
            .issuedAt(issuedAt)
            .expiresAt(expiresAt)
            .id(UUID.randomUUID().toString())
            .claim("token_type", "access")
            .claim("email", user.email())
            .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).type("JWT").build();
        String value = encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return new IssuedAccessToken(value, expiresAt);
    }

    public IssuedRefreshToken issueRefreshToken() {
        byte[] randomBytes = new byte[32];
        secureRandom.nextBytes(randomBytes);
        String value = Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
        return new IssuedRefreshToken(value, hash(value), clock.instant().plus(refreshLifetime));
    }

    public String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    public Instant now() {
        return clock.instant();
    }

    public record IssuedAccessToken(String value, Instant expiresAt) {
    }

    public record IssuedRefreshToken(String value, String hash, Instant expiresAt) {
    }
}
