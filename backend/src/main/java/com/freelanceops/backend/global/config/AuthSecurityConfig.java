package com.freelanceops.backend.global.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

@Configuration
public class AuthSecurityConfig {

    static final String DEVELOPMENT_SECRET = "development-only-auth-secret-change-me";

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    SecretKey authJwtSecretKey(
        @Value("${app.auth.jwt-secret:" + DEVELOPMENT_SECRET + "}") String configuredSecret,
        @Value("${app.environment:development}") String environment
    ) {
        if (configuredSecret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException("APP_AUTH_JWT_SECRET must contain at least 32 UTF-8 bytes");
        }
        if ("production".equalsIgnoreCase(environment) && DEVELOPMENT_SECRET.equals(configuredSecret)) {
            throw new IllegalStateException("production requires a non-default APP_AUTH_JWT_SECRET");
        }
        return new SecretKeySpec(configuredSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    @Bean
    JwtEncoder authJwtEncoder(SecretKey authJwtSecretKey) {
        return NimbusJwtEncoder.withSecretKey(authJwtSecretKey)
            .algorithm(MacAlgorithm.HS256)
            .build();
    }

    @Bean
    JwtDecoder authJwtDecoder(
        SecretKey authJwtSecretKey,
        @Value("${app.auth.issuer:freelance-ops-backend}") String issuer,
        @Value("${app.auth.audience:freelance-ops-web}") String audience
    ) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(authJwtSecretKey)
            .macAlgorithm(MacAlgorithm.HS256)
            .build();
        OAuth2TokenValidator<Jwt> audienceValidator = jwt -> jwt.getAudience().contains(audience)
            ? OAuth2TokenValidatorResult.success()
            : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "required audience is missing", null));
        OAuth2TokenValidator<Jwt> accessTokenValidator = jwt -> "access".equals(jwt.getClaimAsString("token_type"))
            ? OAuth2TokenValidatorResult.success()
            : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "access token required", null));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
            new JwtTimestampValidator(Duration.ofSeconds(5)),
            new JwtIssuerValidator(issuer),
            audienceValidator,
            accessTokenValidator
        ));
        return decoder;
    }
}
