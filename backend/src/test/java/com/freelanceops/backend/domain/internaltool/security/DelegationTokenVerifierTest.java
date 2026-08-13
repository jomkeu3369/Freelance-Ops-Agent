package com.freelanceops.backend.domain.internaltool.security;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DelegationTokenVerifierTest {

    private RSAPublicKey publicKey;
    private JwtEncoder encoder;

    @BeforeEach
    void setUp() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        publicKey = (RSAPublicKey) pair.getPublic();
        RSAKey jwk = new RSAKey.Builder(publicKey)
            .privateKey((RSAPrivateKey) pair.getPrivate())
            .keyID("test-key")
            .build();
        encoder = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(jwk)));
    }

    @Test
    void verifiesAudienceRunScopeAndAsymmetricSignature() {
        UUID initiatedBy = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        DelegationTokenVerifier verifier = verifier(pem(publicKey));

        DelegationPrincipal principal = verifier.verify(token("agent-service", initiatedBy, runId));

        assertThat(principal.runId()).isEqualTo(runId);
        assertThat(principal.initiatedBy()).isEqualTo(initiatedBy);
        assertThat(principal.permissions()).containsExactlyInAnyOrder("agent.run", "project.read");
    }

    @Test
    void rejectsWrongAudience() {
        UUID initiatedBy = UUID.randomUUID();
        DelegationTokenVerifier verifier = verifier(pem(publicKey));

        assertThatThrownBy(() -> verifier.verify(token("another-service", initiatedBy, UUID.randomUUID())))
            .isInstanceOf(DelegationTokenException.class)
            .hasMessage("delegation token is invalid");
    }

    @Test
    void rejectsSubjectThatDoesNotMatchInitiatingUser() {
        UUID initiatedBy = UUID.randomUUID();
        DelegationTokenVerifier verifier = verifier(pem(publicKey));

        assertThatThrownBy(() -> verifier.verify(token("agent-service", initiatedBy, UUID.randomUUID(), UUID.randomUUID().toString())))
            .isInstanceOf(DelegationTokenException.class)
            .hasMessage("delegation token is invalid");
    }

    @Test
    void acceptsPreviousRotationKeyAndRejectsUnknownKeyId() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair previousPair = generator.generateKeyPair();
        RSAPublicKey previousPublicKey = (RSAPublicKey) previousPair.getPublic();
        JwtEncoder previousEncoder = encoder(previousPair, "previous-key");
        JwtEncoder unknownEncoder = encoder(previousPair, "unknown-key");
        DelegationTokenVerifier verifier = new DelegationTokenVerifier(
            pem(publicKey),
            "test-key",
            pem(previousPublicKey),
            "previous-key",
            "issuer",
            "agent-service"
        );
        UUID initiatedBy = UUID.randomUUID();
        UUID runId = UUID.randomUUID();

        assertThat(verifier.verify(token(previousEncoder, "previous-key", "agent-service", initiatedBy, runId, initiatedBy.toString())).runId())
            .isEqualTo(runId);
        assertThatThrownBy(() -> verifier.verify(token(unknownEncoder, "unknown-key", "agent-service", initiatedBy, runId, initiatedBy.toString())))
            .isInstanceOf(DelegationTokenException.class)
            .hasMessage("delegation token is invalid");
    }

    private String token(String audience, UUID initiatedBy, UUID runId) {
        return token(audience, initiatedBy, runId, initiatedBy.toString());
    }

    private String token(String audience, UUID initiatedBy, UUID runId, String subject) {
        return token(encoder, "test-key", audience, initiatedBy, runId, subject);
    }

    private static String token(JwtEncoder encoder, String keyId, String audience, UUID initiatedBy, UUID runId, String subject) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer("issuer")
            .audience(List.of(audience))
            .subject(subject)
            .id(UUID.randomUUID().toString())
            .issuedAt(now)
            .expiresAt(now.plusSeconds(60))
            .claim("run_id", runId.toString())
            .claim("workspace_id", UUID.randomUUID().toString())
            .claim("project_id", UUID.randomUUID().toString())
            .claim("initiated_by", initiatedBy.toString())
            .claim("permissions", List.of("agent.run", "project.read"))
            .build();
        JwsHeader header = JwsHeader.with(SignatureAlgorithm.RS256).keyId(keyId).build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }

    private static JwtEncoder encoder(KeyPair pair, String keyId) {
        RSAKey jwk = new RSAKey.Builder((RSAPublicKey) pair.getPublic())
            .privateKey((RSAPrivateKey) pair.getPrivate())
            .keyID(keyId)
            .build();
        return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(jwk)));
    }

    private static DelegationTokenVerifier verifier(String activePublicKey) {
        return new DelegationTokenVerifier(
            activePublicKey,
            "test-key",
            "",
            "",
            "issuer",
            "agent-service"
        );
    }

    private static String pem(RSAPublicKey key) {
        return "-----BEGIN PUBLIC KEY-----\n"
            + Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(key.getEncoded())
            + "\n-----END PUBLIC KEY-----";
    }
}


