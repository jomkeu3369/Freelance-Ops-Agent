package com.freelanceops.backend.domain.internaltool.controller;

import com.freelanceops.backend.domain.agentrun.service.ToolExecutionAuditService;
import com.freelanceops.backend.domain.internaltool.dto.response.ProjectContext;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenFilter;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenVerifier;
import com.freelanceops.backend.domain.internaltool.service.InternalToolService;
import com.freelanceops.backend.global.config.AuthSecurityConfig;
import com.freelanceops.backend.global.config.SecurityConfig;
import com.freelanceops.backend.global.security.ApiRateLimitFilter;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(
    controllers = InternalToolController.class,
    properties = {
        "app.auth.jwt-secret=test-web-auth-secret-with-at-least-32-bytes",
        "app.auth.issuer=test-issuer",
        "app.auth.audience=test-web"
    }
)
@Import({
    SecurityConfig.class,
    AuthSecurityConfig.class,
    InternalToolSecurityChainWebTest.DelegationTestConfig.class
})
class InternalToolSecurityChainWebTest {

    private static final String KEY_ID = "internal-chain-test";
    private static final String ISSUER = "freelance-ops-backend";
    private static final String TOOL_AUDIENCE = "freelance-ops-spring-tools";
    private static KeyPair keyPair;
    private static JwtEncoder encoder;

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ApiRateLimitFilter rateLimitFilter;
    @MockitoBean
    private InternalToolService toolService;
    @MockitoBean
    private ToolExecutionAuditService auditService;

    @BeforeAll
    static void createSigningKey() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        keyPair = generator.generateKeyPair();
        RSAKey jwk = new RSAKey.Builder((RSAPublicKey) keyPair.getPublic())
            .privateKey((RSAPrivateKey) keyPair.getPrivate())
            .keyID(KEY_ID)
            .build();
        encoder = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(jwk)));
    }

    @Test
    void delegationTokenIsHandledOnlyByInternalSecurityChain() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        ProjectContext context = new ProjectContext(
            projectId,
            UUID.randomUUID(),
            "통합 보안 테스트",
            "내부 Tool 체인을 검증합니다.",
            "KRW",
            null,
            new BigDecimal("100000"),
            new BigDecimal("300000")
        );
        when(auditService.execute(eq("get_project_context"), any(), any(), eq(runId), any()))
            .thenReturn(context);

        mockMvc.perform(get("/internal/v1/projects/{projectId}/context", projectId)
                .header("Authorization", "Bearer " + delegationToken(runId, projectId))
                .header("X-Run-Id", runId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.projectId").value(projectId.toString()));
    }

    @Test
    void invalidDelegationTokenFailsInsideInternalSecurityChain() throws Exception {
        mockMvc.perform(get("/internal/v1/projects/{projectId}/context", UUID.randomUUID())
                .header("Authorization", "Bearer invalid-token")
                .header("X-Run-Id", UUID.randomUUID()))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("DELEGATION_TOKEN_INVALID"));
    }

    private static String delegationToken(UUID runId, UUID projectId) {
        UUID userId = UUID.randomUUID();
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer(ISSUER)
            .audience(List.of("freelance-ops-agent", TOOL_AUDIENCE))
            .subject(userId.toString())
            .id(UUID.randomUUID().toString())
            .issuedAt(now)
            .expiresAt(now.plusSeconds(60))
            .claim("run_id", runId.toString())
            .claim("workspace_id", UUID.randomUUID().toString())
            .claim("project_id", projectId.toString())
            .claim("initiated_by", userId.toString())
            .claim("permissions", List.of("agent.run", "project.read"))
            .build();
        JwsHeader header = JwsHeader.with(SignatureAlgorithm.RS256).keyId(KEY_ID).build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }

    private static String publicKeyPem() {
        return "-----BEGIN PUBLIC KEY-----\n"
            + Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(keyPair.getPublic().getEncoded())
            + "\n-----END PUBLIC KEY-----";
    }

    @TestConfiguration
    static class DelegationTestConfig {

        @Bean
        DelegationTokenVerifier delegationTokenVerifier() {
            return new DelegationTokenVerifier(
                publicKeyPem(),
                KEY_ID,
                "",
                "",
                ISSUER,
                TOOL_AUDIENCE
            );
        }

        @Bean
        DelegationTokenFilter delegationTokenFilter(DelegationTokenVerifier verifier) {
            return new DelegationTokenFilter(verifier);
        }
    }
}
