package com.freelanceops.backend.domain.agentrun.security;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.stereotype.Component;

import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

@Component
public class DelegationTokenIssuer {

    private final JwtEncoder encoder;
    private final String issuer;
    private final List<String> audiences;
    private final Duration lifetime;
    private final Clock clock;
    private final String keyId;

    @Autowired
    public DelegationTokenIssuer(
        @Value("${agent.delegation.private-key:}") String privateKey,
        @Value("${agent.delegation.public-key:}") String publicKey,
        @Value("${agent.delegation.key-id:freelance-ops-v1}") String keyId,
        @Value("${agent.delegation.issuer:freelance-ops-backend}") String issuer,
        @Value("${agent.delegation.agent-audience:freelance-ops-agent}") String agentAudience,
        @Value("${agent.delegation.tool-audience:freelance-ops-spring-tools}") String toolAudience,
        @Value("${agent.delegation.ttl-seconds:60}") long ttlSeconds,
        @Value("${app.environment:development}") String environment
    ) {
        this(
            createEncoder(privateKey, publicKey, keyId),
            issuer,
            List.of(agentAudience, toolAudience),
            Duration.ofSeconds(ttlSeconds),
            Clock.systemUTC(),
            keyId
        );
        if ("production".equalsIgnoreCase(environment) && this.encoder == null) {
            throw new IllegalStateException("production requires delegation signing keys");
        }
    }

    DelegationTokenIssuer(JwtEncoder encoder, String issuer, List<String> audiences, Duration lifetime, Clock clock, String keyId) {
        if (lifetime.isZero() || lifetime.isNegative() || lifetime.compareTo(Duration.ofMinutes(5)) > 0) {
            throw new IllegalArgumentException("delegation token lifetime must be between 1 second and 5 minutes");
        }
        this.encoder = encoder;
        this.issuer = issuer;
        this.audiences = List.copyOf(audiences);
        this.lifetime = lifetime;
        this.clock = clock;
        this.keyId = keyId;
    }

    public String issue(UUID runId, UUID workspaceId, UUID projectId, UUID initiatedBy, List<String> permissions) {
        if (encoder == null) {
            throw new IllegalStateException("delegation signing key is unavailable");
        }
        Instant now = clock.instant();
        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer(issuer)
            .audience(audiences)
            .subject(initiatedBy.toString())
            .id(UUID.randomUUID().toString())
            .issuedAt(now)
            .expiresAt(now.plus(lifetime))
            .claim("run_id", runId.toString())
            .claim("workspace_id", workspaceId.toString())
            .claim("project_id", projectId.toString())
            .claim("initiated_by", initiatedBy.toString())
            .claim("permissions", List.copyOf(permissions))
            .build();
        JwsHeader header = JwsHeader.with(SignatureAlgorithm.RS256).keyId(keyId).build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }

    private static JwtEncoder createEncoder(String privateKey, String publicKey, String keyId) {
        if (privateKey.isBlank() && publicKey.isBlank()) {
            return null;
        }
        if (privateKey.isBlank() || publicKey.isBlank()) {
            throw new IllegalStateException("delegation private and public keys must be configured together");
        }
        try {
            RSAKey jwk = new RSAKey.Builder(parsePublicKey(publicKey))
                .privateKey(parsePrivateKey(privateKey))
                .keyID(keyId)
                .build();
            return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(jwk)));
        } catch (Exception error) {
            throw new IllegalStateException("delegation signing key is invalid", error);
        }
    }

    private static RSAPublicKey parsePublicKey(String value) throws Exception {
        byte[] encoded = Base64.getDecoder().decode(normalizePem(value, "PUBLIC KEY"));
        return (RSAPublicKey) KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(encoded));
    }

    private static RSAPrivateKey parsePrivateKey(String value) throws Exception {
        byte[] encoded = Base64.getDecoder().decode(normalizePem(value, "PRIVATE KEY"));
        return (RSAPrivateKey) KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(encoded));
    }

    private static String normalizePem(String value, String label) {
        return value
            .replace("-----BEGIN " + label + "-----", "")
            .replace("-----END " + label + "-----", "")
            .replaceAll("\\s", "");
    }
}


