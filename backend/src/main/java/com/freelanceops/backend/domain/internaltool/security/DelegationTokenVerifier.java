package com.freelanceops.backend.domain.internaltool.security;

import com.nimbusds.jwt.SignedJWT;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Component;

import java.security.KeyFactory;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
public class DelegationTokenVerifier {

    private static final OAuth2Error INVALID_AUDIENCE = new OAuth2Error("invalid_token", "Invalid audience", null);
    private final Map<String, JwtDecoder> decoders;

    public DelegationTokenVerifier(
        @Value("${agent.delegation.public-key:}") String publicKey,
        @Value("${agent.delegation.key-id:freelance-ops-v1}") String keyId,
        @Value("${agent.delegation.previous-public-key:}") String previousPublicKey,
        @Value("${agent.delegation.previous-key-id:}") String previousKeyId,
        @Value("${agent.delegation.issuer:freelance-ops-backend}") String issuer,
        @Value("${agent.delegation.tool-audience:freelance-ops-spring-tools}") String audience
    ) {
        if (previousPublicKey.isBlank() != previousKeyId.isBlank()) {
            throw new IllegalStateException("previous delegation key id and public key must be configured together");
        }
        if (!previousKeyId.isBlank() && previousKeyId.equals(keyId)) {
            throw new IllegalStateException("active and previous delegation key ids must differ");
        }
        Map<String, JwtDecoder> configured = new LinkedHashMap<>();
        if (!publicKey.isBlank()) configured.put(keyId, decoder(publicKey, issuer, audience));
        if (!previousPublicKey.isBlank()) {
            configured.put(previousKeyId, decoder(previousPublicKey, issuer, audience));
        }
        this.decoders = Map.copyOf(configured);
    }

    public DelegationPrincipal verify(String token) {
        if (decoders.isEmpty() || token == null || token.isBlank()) {
            throw new DelegationTokenException("delegation token is unavailable");
        }
        try {
            String keyId = SignedJWT.parse(token).getHeader().getKeyID();
            JwtDecoder decoder = keyId == null ? null : decoders.get(keyId);
            if (decoder == null) throw new IllegalArgumentException("unknown delegation key id");
            Jwt jwt = decoder.decode(token);
            requireClaims(jwt);
            List<?> permissionValues = jwt.getClaimAsStringList("permissions");
            if (permissionValues == null || permissionValues.stream().anyMatch(value -> !(value instanceof String))) {
                throw new IllegalArgumentException("invalid permissions");
            }
            Set<String> permissions = permissionValues.stream()
                .map(String.class::cast)
                .collect(Collectors.toUnmodifiableSet());
            DelegationPrincipal principal = new DelegationPrincipal(
                jwt.getSubject(),
                jwt.getId(),
                UUID.fromString(jwt.getClaimAsString("run_id")),
                UUID.fromString(jwt.getClaimAsString("workspace_id")),
                UUID.fromString(jwt.getClaimAsString("project_id")),
                UUID.fromString(jwt.getClaimAsString("initiated_by")),
                permissions
            );
            if (!principal.subject().equals(principal.initiatedBy().toString())) {
                throw new IllegalArgumentException("delegated subject does not match initiated_by");
            }
            return principal;
        } catch (java.text.ParseException | JwtException | IllegalArgumentException error) {
            throw new DelegationTokenException("delegation token is invalid", error);
        }
    }

    private static JwtDecoder decoder(String publicKey, String issuer, String audience) {
        try {
            NimbusJwtDecoder decoder = NimbusJwtDecoder.withPublicKey(parsePublicKey(publicKey))
                .signatureAlgorithm(SignatureAlgorithm.RS256)
                .build();
            JwtTimestampValidator timestamp = new JwtTimestampValidator(Duration.ofSeconds(5));
            JwtIssuerValidator issuerValidator = new JwtIssuerValidator(issuer);
            OAuth2TokenValidator<Jwt> audienceValidator = jwt -> jwt.getAudience().contains(audience)
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(INVALID_AUDIENCE);
            decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(timestamp, issuerValidator, audienceValidator));
            return decoder;
        } catch (Exception error) {
            throw new IllegalStateException("delegation public key is invalid", error);
        }
    }

    private static RSAPublicKey parsePublicKey(String value) throws Exception {
        String normalized = value
            .replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .replaceAll("\\s", "");
        byte[] encoded = Base64.getDecoder().decode(normalized);
        return (RSAPublicKey) KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(encoded));
    }

    private static void requireClaims(Jwt jwt) {
        if (jwt.getSubject() == null || jwt.getId() == null || jwt.getIssuedAt() == null || jwt.getExpiresAt() == null
            || jwt.getClaimAsString("run_id") == null || jwt.getClaimAsString("workspace_id") == null
            || jwt.getClaimAsString("project_id") == null || jwt.getClaimAsString("initiated_by") == null) {
            throw new IllegalArgumentException("required delegation claims are missing");
        }
    }
}


