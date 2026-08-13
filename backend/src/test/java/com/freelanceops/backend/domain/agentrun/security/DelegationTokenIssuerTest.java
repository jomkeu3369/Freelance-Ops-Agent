package com.freelanceops.backend.domain.agentrun.security;

import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenVerifier;
import org.junit.jupiter.api.Test;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DelegationTokenIssuerTest {

    @Test
    void issuesShortLivedRunBoundTokenAcceptedByAgentVerifierContract() throws Exception {
        KeyPair pair = keyPair();
        DelegationTokenIssuer issuer = new DelegationTokenIssuer(
            pem((RSAPrivateKey) pair.getPrivate()),
            pem((RSAPublicKey) pair.getPublic()),
            "test-key",
            "backend",
            "agent",
            "spring-tools",
            60,
            "test"
        );
        UUID runId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        String token = issuer.issue(
            runId,
            workspaceId,
            projectId,
            userId,
            List.of("agent.run", "project.read")
        );

        DelegationPrincipal principal = new DelegationTokenVerifier(
            pem((RSAPublicKey) pair.getPublic()),
            "test-key",
            "",
            "",
            "backend",
            "agent"
        ).verify(token);
        assertThat(principal.runId()).isEqualTo(runId);
        assertThat(principal.workspaceId()).isEqualTo(workspaceId);
        assertThat(principal.projectId()).isEqualTo(projectId);
        assertThat(principal.initiatedBy()).isEqualTo(userId);
        assertThat(principal.permissions()).containsExactlyInAnyOrder("agent.run", "project.read");
        assertThat(new DelegationTokenVerifier(
            pem((RSAPublicKey) pair.getPublic()),
            "test-key",
            "",
            "",
            "backend",
            "spring-tools"
        ).verify(token).runId()).isEqualTo(runId);
    }

    @Test
    void refusesToIssueWhenSigningKeysAreMissing() {
        DelegationTokenIssuer issuer = new DelegationTokenIssuer(
            "",
            "",
            "key",
            "backend",
            "agent",
            "spring-tools",
            60,
            "test"
        );

        assertThatThrownBy(() -> issuer.issue(
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            List.of("agent.run")
        ))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("delegation signing key is unavailable");
    }

    @Test
    void refusesProductionStartupWithoutSigningKeys() {
        assertThatThrownBy(() -> new DelegationTokenIssuer(
            "",
            "",
            "key",
            "backend",
            "agent",
            "spring-tools",
            60,
            "production"
        ))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("production requires delegation signing keys");
    }

    private static KeyPair keyPair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        return generator.generateKeyPair();
    }

    private static String pem(RSAPublicKey key) {
        return pem("PUBLIC KEY", key.getEncoded());
    }

    private static String pem(RSAPrivateKey key) {
        return pem("PRIVATE KEY", key.getEncoded());
    }

    private static String pem(String label, byte[] encoded) {
        return "-----BEGIN " + label + "-----\n"
            + Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(encoded)
            + "\n-----END " + label + "-----";
    }
}


