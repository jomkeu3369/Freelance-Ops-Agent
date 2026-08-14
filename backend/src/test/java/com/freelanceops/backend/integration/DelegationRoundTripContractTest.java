package com.freelanceops.backend.integration;

import tools.jackson.databind.ObjectMapper;
import com.freelanceops.backend.domain.agentrun.client.HttpAgentRunClient;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.SafetyContext;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import com.freelanceops.backend.domain.agentrun.entity.ToolExecutionEntity;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.agentrun.model.ReasoningEffort;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.repository.ToolExecutionRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.agentrun.service.ToolExecutionAuditService;
import com.freelanceops.backend.domain.internaltool.controller.InternalToolController;
import com.freelanceops.backend.domain.internaltool.controller.InternalToolExceptionHandler;
import com.freelanceops.backend.domain.internaltool.dto.response.ProjectContext;
import com.freelanceops.backend.domain.internaltool.security.DelegationPrincipal;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenFilter;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenVerifier;
import com.freelanceops.backend.domain.internaltool.service.InternalToolService;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class DelegationRoundTripContractTest {

    private static final String KEY_ID = "round-trip-key";
    private static final String ISSUER = "round-trip-backend";
    private static final String AGENT_AUDIENCE = "freelance-ops-agent";
    private static final String TOOL_AUDIENCE = "freelance-ops-spring-tools";
    private static final String TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

    private final InternalToolService toolService = mock(InternalToolService.class);
    private final ToolExecutionRepository executionRepository = mock(ToolExecutionRepository.class);
    private final AgentRunRepository runRepository = mock(AgentRunRepository.class);
    private final AtomicReference<DelegationPrincipal> agentPrincipal = new AtomicReference<>();

    private HttpServer agentServer;
    private MockMvc toolApi;
    private DelegationTokenIssuer tokenIssuer;
    private DelegationTokenVerifier agentVerifier;

    @BeforeEach
    void setUp() throws Exception {
        KeyPair pair = keyPair();
        String privateKey = pem("PRIVATE KEY", ((RSAPrivateKey) pair.getPrivate()).getEncoded());
        String publicKey = pem("PUBLIC KEY", ((RSAPublicKey) pair.getPublic()).getEncoded());
        tokenIssuer = new DelegationTokenIssuer(
            privateKey, publicKey, KEY_ID, ISSUER, AGENT_AUDIENCE, TOOL_AUDIENCE, 60, "test"
        );
        agentVerifier = new DelegationTokenVerifier(publicKey, KEY_ID, "", "", ISSUER, AGENT_AUDIENCE);
        DelegationTokenVerifier toolVerifier = new DelegationTokenVerifier(
            publicKey, KEY_ID, "", "", ISSUER, TOOL_AUDIENCE
        );
        ToolExecutionAuditService auditService = new ToolExecutionAuditService(
            executionRepository, runRepository, new ObjectMapper()
        );
        toolApi = MockMvcBuilders.standaloneSetup(new InternalToolController(toolService, auditService))
            .setControllerAdvice(new InternalToolExceptionHandler())
            .addFilters(new DelegationTokenFilter(toolVerifier))
            .build();
        when(executionRepository.save(any(ToolExecutionEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        agentServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        agentServer.createContext("/internal/v1/agent-runs", this::handleAgentStart);
        agentServer.start();
    }

    @AfterEach
    void tearDown() {
        agentServer.stop(0);
    }

    @Test
    void sameIssuedTokenTraversesAgentHttpAndReturnsThroughSpringToolBoundary() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String token = tokenIssuer.issue(
            runId, workspaceId, projectId, userId, List.of("agent.run", "project.read")
        );
        when(runRepository.existsByIdAndWorkspaceId(runId, workspaceId)).thenReturn(true);
        when(toolService.getProjectContext(eq(projectId), any())).thenReturn(new ProjectContext(
            projectId,
            workspaceId,
            "왕복 계약 프로젝트",
            "Spring과 Agent 사이의 위임 경계를 검증합니다.",
            "KRW",
            null,
            new BigDecimal("1000000"),
            new BigDecimal("2000000")
        ));

        HttpAgentRunClient client = new HttpAgentRunClient(
            RestClient.builder(),
            "http://127.0.0.1:" + agentServer.getAddress().getPort()
        );
        StartAgentRunResponse response = client.start(
            request(runId, workspaceId, projectId, userId), token, TRACEPARENT
        );

        assertThat(response.runId()).isEqualTo(runId);
        assertThat(response.status()).isEqualTo(AgentRunStatus.QUEUED);
        assertThat(agentPrincipal.get()).isNotNull();
        assertThat(agentPrincipal.get().runId()).isEqualTo(runId);
        verify(toolService).getProjectContext(eq(projectId), any());
        verify(executionRepository, times(2)).save(any(ToolExecutionEntity.class));
    }

    private void handleAgentStart(HttpExchange exchange) throws IOException {
        try {
            String authorization = exchange.getRequestHeaders().getFirst("Authorization");
            String traceparent = exchange.getRequestHeaders().getFirst("traceparent");
            if (authorization == null || !authorization.startsWith("Bearer ") || !TRACEPARENT.equals(traceparent)) {
                respond(exchange, 401, "{}");
                return;
            }
            String token = authorization.substring(7);
            DelegationPrincipal principal = agentVerifier.verify(token);
            agentPrincipal.set(principal);
            toolApi.perform(get("/internal/v1/projects/{projectId}/context", principal.projectId())
                    .header("Authorization", "Bearer " + token)
                    .header("X-Run-Id", principal.runId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.workspaceId").value(principal.workspaceId().toString()));
            respond(
                exchange,
                200,
                "{\"runId\":\"" + principal.runId()
                    + "\",\"status\":\"QUEUED\",\"acceptedAt\":\"2026-08-14T00:00:00Z\"}"
            );
        } catch (Exception error) {
            respond(exchange, 500, "{}");
        }
    }

    private static InternalAgentRunRequest request(UUID runId, UUID workspaceId, UUID projectId, UUID userId) {
        return new InternalAgentRunRequest(
            new InternalAgentRunRequest.TrustedRunContext(
                runId, UUID.randomUUID(), TRACEPARENT, workspaceId, projectId, userId,
                List.of("agent.run", "project.read")
            ),
            new RunBudget(120, 5, 10, 10000, 5000, 2, 2, 5, 1, 2),
            new ModelSelection(Provider.OPENAI, "gpt-test", ReasoningEffort.LOW),
            new SafetyContext(false, false, false, false, false, false, true),
            new InternalAgentRunRequest.AgentInput("요구사항", "ko-KR", "KR", null)
        );
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] encoded = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, encoded.length);
        exchange.getResponseBody().write(encoded);
        exchange.close();
    }

    private static KeyPair keyPair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        return generator.generateKeyPair();
    }

    private static String pem(String label, byte[] encoded) {
        return "-----BEGIN " + label + "-----\n"
            + Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(encoded)
            + "\n-----END " + label + "-----";
    }
}
