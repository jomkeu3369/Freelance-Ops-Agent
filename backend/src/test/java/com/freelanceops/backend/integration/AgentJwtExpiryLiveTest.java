package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.client.HttpAgentRunClient;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.*;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.model.*;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.agentrun.service.ToolExecutionAuditService;
import com.freelanceops.backend.domain.internaltool.controller.InternalToolController;
import com.freelanceops.backend.domain.internaltool.dto.response.ProjectContext;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenFilter;
import com.freelanceops.backend.domain.internaltool.security.DelegationTokenVerifier;
import com.freelanceops.backend.domain.internaltool.service.InternalToolService;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.json.JsonMapper;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/** Wall-clock expiry: actual Spring JWT filter/controller + HTTP tools + Operational executor + PostgreSQL.
 * Business data/audit and provider replies are synthetic; there is no provider HTTP or clock patch. */
@EnabledIfEnvironmentVariable(named = "AGENT_LIVE_LONG_TEST", matches = "true")
class AgentJwtExpiryLiveTest {
    private static final String TRACE = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    private static final List<String> PERMISSIONS = List.of("agent.run", "agent.respond", "project.read");
    private Process peer;

    @Test @Timeout(130)
    void expiredExecutionTokenStopsLateToolsPreservesWorkAndNeverReplaysFailedRun() throws Exception {
        var mapper = JsonMapper.builder().findAndAddModules().build();
        var keysField = ConnectedWorkflowPostgresTest.class.getDeclaredField("TEST_KEYS");
        keysField.setAccessible(true);
        KeyPair keys = (KeyPair) keysField.get(null); // Reuse the official ephemeral test fixture; never operational keys.
        String publicKey = Base64.getEncoder().encodeToString(keys.getPublic().getEncoded());
        var issuer = new DelegationTokenIssuer(Base64.getEncoder().encodeToString(keys.getPrivate().getEncoded()),
            publicKey, "long-run-test", "long-run-backend", "freelance-ops-agent", "freelance-ops-spring-tools", 60, "test");
        UUID run = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID(), user = UUID.randomUUID();
        var request = new InternalAgentRunRequest(new InternalAgentRunRequest.TrustedRunContext(run, UUID.randomUUID(),
            TRACE, workspace, project, user, PERMISSIONS), new RunBudget(180, 12, 8, 50000, 48000, 4, 2, 0, 0, 3),
            new ModelSelection(Provider.OPENAI, "gpt-test", ReasoningEffort.LOW),
            new SafetyContext(false, false, false, false, false, false, true),
            new InternalAgentRunRequest.AgentInput("Synthetic long-running expiry verification", "en", "KR", null));
        String executionToken = issuer.issue(run, workspace, project, user, PERMISSIONS);
        Instant expiresAt = SignedJWT.parse(executionToken).getJWTClaimsSet().getExpirationTime().toInstant();
        var toolService = mock(InternalToolService.class);
        when(toolService.getProjectContext(eq(project), any())).thenReturn(new ProjectContext(project, workspace,
            "Synthetic project", "Synthetic requirements", "KRW", null, null, null, List.of()));
        var audit = mock(ToolExecutionAuditService.class);
        when(audit.execute(anyString(), any(), any(), any(), any()))
            .thenAnswer(call -> ((Supplier<?>) call.getArgument(4)).get());
        var toolApi = MockMvcBuilders.standaloneSetup(new InternalToolController(toolService, audit))
            .addFilters(new DelegationTokenFilter(new DelegationTokenVerifier(publicKey, "long-run-test", "", "",
                "long-run-backend", "freelance-ops-spring-tools"))).build();
        var statuses = new CopyOnWriteArrayList<Integer>();
        var observedAt = new CopyOnWriteArrayList<Instant>();
        var originalTokenOnly = new AtomicBoolean(true);
        HttpServer tools = HttpServer.create(new InetSocketAddress("127.0.0.1", 18111), 0);
        tools.createContext("/internal/v1", exchange -> {
            try {
                String authorization = exchange.getRequestHeaders().getFirst("Authorization");
                if (!("Bearer " + executionToken).equals(authorization)) originalTokenOnly.set(false);
                var response = toolApi.perform(get(exchange.getRequestURI().getPath()).header("Authorization", authorization)
                    .header("X-Run-Id", exchange.getRequestHeaders().getFirst("X-Run-Id"))).andReturn().getResponse();
                statuses.add(response.getStatus());
                observedAt.add(Instant.now());
                byte[] body = response.getContentAsByteArray();
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(response.getStatus(), body.length);
                exchange.getResponseBody().write(body);
            } catch (Exception error) { exchange.sendResponseHeaders(500, -1); }
            finally { exchange.close(); }
        });
        tools.start();
        var directory = Path.of("..", ".tmp", "long-jwt").toAbsolutePath().normalize();
        Files.createDirectories(directory);
        var fixture = directory.resolve("fixture.json");
        Files.writeString(fixture, mapper.writeValueAsString(Map.of("request", request, "publicKey", publicKey,
            "expiresAt", expiresAt.toString(), "toolBaseUrl", "http://127.0.0.1:18111")));
        var client = new HttpAgentRunClient(RestClient.builder(), "http://127.0.0.1:18115");
        long started = System.nanoTime();
        try {
            startPeer(fixture);
            assertThat(client.start(request, executionToken, TRACE).status()).isEqualTo(AgentRunStatus.QUEUED);
            AgentRunView saved = null;
            long saveDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            do {
                saved = client.get(run, executionToken, TRACE);
                if (saved.result() != null) break;
                Thread.sleep(50);
            } while (System.nanoTime() < saveDeadline);
            assertThat(saved.status()).isEqualTo(AgentRunStatus.RUNNING);
            assertThat(saved.result().departmentResults()).hasSize(1);
            // Wait in short intervals so this test remains interruptible. Keep every production expiry check.
            while (Instant.now().isBefore(expiresAt.plusSeconds(8))) Thread.sleep(500);
            String readToken = issuer.issue(run, workspace, project, user, List.of("agent.run"));
            AgentRunView failed = null;
            long terminalDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            do {
                failed = client.get(run, readToken, TRACE);
                if (failed.status() == AgentRunStatus.FAILED) break;
                Thread.sleep(50);
            } while (System.nanoTime() < terminalDeadline);
            assertThat(failed.status()).isEqualTo(AgentRunStatus.FAILED);
            assertThat(failed.errorCode()).isEqualTo("SPRING_TOOL_UNAUTHORIZED");
            assertThat(failed.result()).isEqualTo(saved.result());
            assertThat(failed.usage().modelCalls()).isEqualTo(3);
            assertThat(statuses).containsExactly(200, 401);
            assertThat(observedAt.get(0)).isBefore(expiresAt);
            assertThat(observedAt.get(1)).isAfter(expiresAt.plusSeconds(5));
            assertThat(originalTokenOnly.get()).isTrue();
            assertThatThrownBy(() -> client.get(run, executionToken, TRACE))
                .isInstanceOfSatisfying(RestClientResponseException.class,
                    error -> assertThat(error.getStatusCode().value()).isEqualTo(401));
            stopPeer();
            startPeer(fixture);
            var restored = client.get(run, readToken, TRACE);
            assertThat(restored.status()).isEqualTo(AgentRunStatus.FAILED);
            assertThat(restored.result()).isEqualTo(saved.result());
            String retryToken = issuer.issue(run, workspace, project, user, PERMISSIONS);
            assertThat(client.start(request, retryToken, TRACE).status()).isEqualTo(AgentRunStatus.FAILED);
            assertThatThrownBy(() -> client.resume(run, new ResumeAgentRunRequest(UUID.randomUUID(), "retry-failed",
                List.of(new ResumeAgentRunRequest.ResumeAnswer(0, "Synthetic"))), retryToken, TRACE))
                .isInstanceOfSatisfying(RestClientResponseException.class,
                    error -> assertThat(error.getStatusCode().value()).isEqualTo(409));
            assertThat(client.get(run, readToken, TRACE).usage()).isEqualTo(failed.usage());
            String events;
            try (var stream = client.events(run, 0L, readToken, TRACE)) {
                events = new String(stream.body().readAllBytes(), StandardCharsets.UTF_8);
            }
            assertThat(events).contains("department.saved", "run.failed", "SPRING_TOOL_UNAUTHORIZED")
                .doesNotContain("run.completed");
            assertThat(events.split("event: run.started", -1)).hasSize(2);
            Files.writeString(directory.resolve("evidence.json"), mapper.writeValueAsString(Map.ofEntries(
                Map.entry("runId", run), Map.entry("capturedAt", Instant.now()), Map.entry("jwtTtlSeconds", 60),
                Map.entry("budgetSeconds", 180), Map.entry("elapsedSeconds", (System.nanoTime() - started) / 1e9),
                Map.entry("toolStatuses", statuses), Map.entry("toolObservedAt", observedAt), Map.entry("expiresAt", expiresAt),
                Map.entry("status", restored.status()), Map.entry("errorCode", restored.errorCode()),
                Map.entry("savedDepartments", restored.result().departmentResults().size()),
                Map.entry("modelCalls", failed.usage().modelCalls()), Map.entry("startRetry", "FAILED; no replay"),
                Map.entry("resumeRetry", 409), Map.entry("providerCalls", "synthetic replies; no external model HTTP"))));
        } finally { stopPeer(); tools.stop(0); }
    }

    private void startPeer(Path fixture) throws Exception {
        var agent = Path.of("..", "agent").toAbsolutePath().normalize();
        var process = new ProcessBuilder(System.getenv("AGENT_LIVE_TEST_PYTHON"), "tests/support/expired_jwt_http_peer.py",
            "--fixture-file", fixture.toString(), "--port", "18115").directory(agent.toFile())
            .redirectErrorStream(true).redirectOutput(fixture.resolveSibling("peer.log").toFile());
        process.environment().put("PYTHONPATH", agent.resolve("src").toString());
        peer = process.start();
        var probe = java.net.http.HttpClient.newBuilder().version(java.net.http.HttpClient.Version.HTTP_1_1).build();
        var request = java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:18115/health/readiness"))
            .timeout(java.time.Duration.ofSeconds(1)).GET().build();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        while (peer.isAlive() && System.nanoTime() < deadline) {
            try { if (probe.send(request, java.net.http.HttpResponse.BodyHandlers.discarding()).statusCode() == 200) return; }
            catch (java.io.IOException ignored) { }
            Thread.sleep(50);
        }
        throw new IllegalStateException("Long-run local Agent peer did not become ready; inspect peer log");
    }

    private void stopPeer() throws Exception {
        if (peer != null) {
            peer.destroy();
            if (!peer.waitFor(3, TimeUnit.SECONDS)) peer.destroyForcibly();
            peer = null;
        }
    }
}
