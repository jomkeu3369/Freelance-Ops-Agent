package com.freelanceops.backend.domain.internaltool.controller;

import tools.jackson.databind.ObjectMapper;
import com.freelanceops.backend.domain.agentrun.entity.ToolExecutionEntity;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.repository.ToolExecutionRepository;
import com.freelanceops.backend.domain.agentrun.service.ToolExecutionAuditService;
import com.freelanceops.backend.domain.internaltool.dto.response.ProjectContext;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenFilter;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenVerifier;
import com.freelanceops.backend.domain.internaltool.service.InternalToolService;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

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
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class InternalToolControllerWebTest {

    private static final String KEY_ID = "tool-test-key";
    private static final String ISSUER = "tool-test-issuer";
    private static final String TOOL_AUDIENCE = "freelance-ops-spring-tools";

    private final InternalToolService toolService = mock(InternalToolService.class);
    private final ToolExecutionRepository executionRepository = mock(ToolExecutionRepository.class);
    private final AgentRunRepository runRepository = mock(AgentRunRepository.class);

    private MockMvc mockMvc;
    private JwtEncoder encoder;

    @BeforeEach
    void setUp() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        RSAPublicKey publicKey = (RSAPublicKey) pair.getPublic();
        RSAKey jwk = new RSAKey.Builder(publicKey)
            .privateKey((RSAPrivateKey) pair.getPrivate())
            .keyID(KEY_ID)
            .build();
        encoder = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(jwk)));

        DelegationTokenVerifier verifier = new DelegationTokenVerifier(
            pem(publicKey), KEY_ID, "", "", ISSUER, TOOL_AUDIENCE
        );
        ToolExecutionAuditService auditService = new ToolExecutionAuditService(
            executionRepository, runRepository, new ObjectMapper()
        );
        InternalToolController controller = new InternalToolController(toolService, auditService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new InternalToolExceptionHandler())
            .addFilters(new DelegationTokenFilter(verifier))
            .build();

        when(executionRepository.save(any(ToolExecutionEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));
    }

    @Test
    void acceptsSignedRunBoundTokenAndInvokesAuditedToolThroughHttp() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        ProjectContext context = new ProjectContext(
            projectId,
            workspaceId,
            "공개 견적 프로젝트",
            "근거가 연결된 견적을 작성합니다.",
            "KRW",
            null,
            new BigDecimal("1000000"),
            new BigDecimal("3000000")
        );
        when(runRepository.existsByIdAndWorkspaceId(runId, workspaceId)).thenReturn(true);
        when(toolService.getProjectContext(eq(projectId), any())).thenReturn(context);

        mockMvc.perform(get("/internal/v1/projects/{projectId}/context", projectId)
                .header("Authorization", "Bearer " + token(TOOL_AUDIENCE, runId, workspaceId, projectId, userId))
                .header("X-Run-Id", runId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.projectId").value(projectId.toString()))
            .andExpect(jsonPath("$.workspaceId").value(workspaceId.toString()))
            .andExpect(jsonPath("$.title").value("공개 견적 프로젝트"));

        verify(runRepository).existsByIdAndWorkspaceId(runId, workspaceId);
        verify(toolService).getProjectContext(eq(projectId), any());
        verify(executionRepository, times(2)).save(any(ToolExecutionEntity.class));
    }

    @Test
    void rejectsTokenForAgentAudienceBeforeControllerAndAudit() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();

        mockMvc.perform(get("/internal/v1/projects/{projectId}/context", projectId)
                .header("Authorization", "Bearer " + token(
                    "freelance-ops-agent", runId, workspaceId, projectId, UUID.randomUUID()
                ))
                .header("X-Run-Id", runId))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("DELEGATION_TOKEN_INVALID"));

        verify(runRepository, never()).existsByIdAndWorkspaceId(any(), any());
        verify(toolService, never()).getProjectContext(any(), any());
        verify(executionRepository, never()).save(any());
    }

    @Test
    void rejectsRunHeaderThatDoesNotMatchSignedClaim() throws Exception {
        UUID tokenRunId = UUID.randomUUID();
        UUID requestRunId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();

        mockMvc.perform(get("/internal/v1/projects/{projectId}/context", projectId)
                .header("Authorization", "Bearer " + token(
                    TOOL_AUDIENCE, tokenRunId, workspaceId, projectId, UUID.randomUUID()
                ))
                .header("X-Run-Id", requestRunId))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("DELEGATION_TOKEN_INVALID"));

        verify(runRepository, never()).existsByIdAndWorkspaceId(any(), any());
        verify(toolService, never()).getProjectContext(any(), any());
    }

    private String token(String audience, UUID runId, UUID workspaceId, UUID projectId, UUID userId) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer(ISSUER)
            .audience(List.of(audience))
            .subject(userId.toString())
            .id(UUID.randomUUID().toString())
            .issuedAt(now)
            .expiresAt(now.plusSeconds(60))
            .claim("run_id", runId.toString())
            .claim("workspace_id", workspaceId.toString())
            .claim("project_id", projectId.toString())
            .claim("initiated_by", userId.toString())
            .claim("permissions", List.of("agent.run", "project.read"))
            .build();
        JwsHeader header = JwsHeader.with(SignatureAlgorithm.RS256).keyId(KEY_ID).build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }

    private static String pem(RSAPublicKey key) {
        return "-----BEGIN PUBLIC KEY-----\n"
            + Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(key.getEncoded())
            + "\n-----END PUBLIC KEY-----";
    }
}
