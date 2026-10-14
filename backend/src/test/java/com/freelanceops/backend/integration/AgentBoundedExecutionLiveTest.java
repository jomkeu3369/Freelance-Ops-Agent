package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.client.HttpAgentRunClient;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.*;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.entity.AgentRunEntity;
import com.freelanceops.backend.domain.agentrun.model.*;
import com.freelanceops.backend.domain.agentrun.repository.AgentRunRepository;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.agentrun.service.*;
import com.freelanceops.backend.domain.internaltool.controller.InternalToolController;
import com.freelanceops.backend.domain.internaltool.dto.response.ProjectContext;
import com.freelanceops.backend.domain.internaltool.security.*;
import com.freelanceops.backend.domain.internaltool.service.*;
import com.freelanceops.backend.domain.project.entity.ProjectEntity;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.*;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.json.JsonMapper;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.security.KeyPair;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Supplier;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/** Actual wall time, HTTP, operational executor and PG17; business repositories/provider replies are fixtures. */
@EnabledIfEnvironmentVariable(named="AGENT_LIVE_BOUNDED_TEST", matches="true")
class AgentBoundedExecutionLiveTest {
    private static final String TRACE = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    private static final List<String> SCOPE = List.of("agent.run", "agent.respond", "agent.cancel", "project.read");
    private final JsonMapper mapper = JsonMapper.builder().findAndAddModules().build();
    private final List<Process> peers = new ArrayList<>();
    private final Map<UUID, AgentRunEntity> projections = new ConcurrentHashMap<>();
    private final Map<UUID, List<Integer>> toolStatuses = new ConcurrentHashMap<>();
    private final UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), project = UUID.randomUUID();
    private final Path directory = Path.of("..", ".tmp", "bounded-jwt").toAbsolutePath().normalize();

    @Test @Timeout(225)
    void boundedExecutionCrossesSixtySecondsButStopsAtTheOriginalDeadline() throws Exception {
        var field = ConnectedWorkflowPostgresTest.class.getDeclaredField("TEST_KEYS");
        field.setAccessible(true);
        KeyPair keys = (KeyPair) field.get(null);
        String publicKey = Base64.getEncoder().encodeToString(keys.getPublic().getEncoded());
        var issuer = new DelegationTokenIssuer(Base64.getEncoder().encodeToString(keys.getPrivate().getEncoded()),
            publicKey, "long-run-test", "long-run-backend", "freelance-ops-agent", "freelance-ops-spring-tools", 60, "test");
        Instant created = Instant.now(), deadline = created.plusSeconds(180).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        var success = request(created);
        var timeout = request(created);
        var cancelled = request(created);
        HttpServer tools = toolServer(publicKey);
        Files.createDirectories(directory);
        long started = System.nanoTime();
        Map<UUID, String> executionTokens = new HashMap<>(), originalTokens = new HashMap<>();
        for (var request : List.of(success, timeout, cancelled)) {
            UUID id = request.context().runId();
            executionTokens.put(id, issuer.issueForExecution(id, workspace, project, user, SCOPE, deadline));
            originalTokens.put(id, issuer.issue(id, workspace, project, user, SCOPE));
        }
        try {
            Instant originalExpires = com.nimbusds.jwt.SignedJWT.parse(originalTokens.get(success.context().runId()))
                .getJWTClaimsSet().getExpirationTime().toInstant();
            startPeer(success, publicKey, originalExpires, deadline, "complete", 18122);
            startPeer(timeout, publicKey, originalExpires, deadline, "timeout", 18123);
            var normal = new HttpAgentRunClient(RestClient.builder(), "http://127.0.0.1:18122");
            var slow = new HttpAgentRunClient(RestClient.builder(), "http://127.0.0.1:18123");
            var clients = Map.of(success.context().runId(), normal, timeout.context().runId(), slow, cancelled.context().runId(), slow);
            for (var request : List.of(success, timeout, cancelled)) {
                UUID id = request.context().runId();
                String execution = executionTokens.get(id);
                String original = originalTokens.get(id);
                assertThatThrownBy(() -> clients.get(id).start(request, original, TRACE))
                    .isInstanceOfSatisfying(RestClientResponseException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(403));
                assertThat(clients.get(id).start(request, execution, TRACE).status()).isEqualTo(AgentRunStatus.QUEUED);
                await(clients.get(id), id, execution, AgentRunStatus.RUNNING, true, Duration.ofSeconds(10));
            }
            var completed = await(normal, success.context().runId(), executionTokens.get(success.context().runId()),
                AgentRunStatus.COMPLETED, false, Duration.ofSeconds(85));
            Instant completedAt = Instant.now();
            assertThat(completedAt).isAfter(originalExpires.plusSeconds(5));
            assertThat(completed.result().departmentResults()).hasSize(4);
            assertThat(toolStatuses.get(success.context().runId())).containsOnly(200).hasSize(4);
            String old = originalTokens.get(success.context().runId());
            assertThatThrownBy(() -> normal.get(success.context().runId(), old, TRACE))
                .isInstanceOfSatisfying(RestClientResponseException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(401));
            String cancelControl = issuer.issue(cancelled.context().runId(), workspace, project, user, SCOPE);
            assertThat(slow.cancel(cancelled.context().runId(), cancelControl, TRACE).status()).isEqualTo(AgentRunStatus.CANCELLED);
            projections.get(cancelled.context().runId()).updateStatus(AgentRunStatus.CANCELLED, Instant.now());
            assertThat(probeTool(cancelled.context().runId(), executionTokens.get(cancelled.context().runId()))).isEqualTo(401);
            projections.get(success.context().runId()).updateStatus(AgentRunStatus.COMPLETED, Instant.now());
            assertThat(probeTool(success.context().runId(), executionTokens.get(success.context().runId()))).isEqualTo(401);
            while (Instant.now().isBefore(deadline.plusSeconds(1))) Thread.sleep(500);
            String read = issuer.issue(timeout.context().runId(), workspace, project, user, List.of("agent.run"));
            var failed = await(slow, timeout.context().runId(), read, AgentRunStatus.FAILED, false, Duration.ofSeconds(5));
            assertThat(failed.errorCode()).isEqualTo("RUN_TIMEOUT");
            assertThat(failed.result().departmentResults()).hasSize(1);
            assertThat(toolStatuses.get(timeout.context().runId())).containsExactly(200);
            assertThat(probeTool(timeout.context().runId(), executionTokens.get(timeout.context().runId()))).isEqualTo(401);
            assertThatThrownBy(() -> slow.get(timeout.context().runId(), executionTokens.get(timeout.context().runId()), TRACE))
                .isInstanceOfSatisfying(RestClientResponseException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(401));
            assertThat(slow.get(cancelled.context().runId(), issuer.issue(cancelled.context().runId(), workspace, project, user, List.of("agent.run")), TRACE).status()).isEqualTo(AgentRunStatus.CANCELLED);
            Files.writeString(directory.resolve("evidence.json"), mapper.writeValueAsString(Map.ofEntries(
                Map.entry("capturedAt", Instant.now()), Map.entry("deadline", deadline), Map.entry("budgetSeconds", 180),
                Map.entry("originalExpiresAt", originalExpires), Map.entry("completedAt", completedAt),
                Map.entry("originalJwtTtlSeconds", 60), Map.entry("elapsedSeconds", (System.nanoTime()-started)/1e9),
                Map.entry("successRunId", success.context().runId()), Map.entry("success", completed.status()),
                Map.entry("savedSuccessDepartments", 4), Map.entry("timeoutRunId", timeout.context().runId()),
                Map.entry("timeout", failed.errorCode()), Map.entry("savedTimeoutDepartments", 1),
                Map.entry("cancelledRunId", cancelled.context().runId()), Map.entry("cancelled", "CANCELLED"),
                Map.entry("toolStatuses", toolStatuses), Map.entry("externalModelCalls", 0))));
        } finally {
            for (var peer : peers) { peer.destroy(); if (!peer.waitFor(3, TimeUnit.SECONDS)) peer.destroyForcibly(); }
            tools.stop(0);
        }
    }

    private InternalAgentRunRequest request(Instant created) {
        UUID id = UUID.randomUUID();
        var budget = new RunBudget(180, 12, 8, 50000, 48000, 4, 2, 0, 0, 3);
        var row = new AgentRunEntity(id, workspace, project, UUID.randomUUID(), user, Provider.OPENAI, "gpt-test",
            ReasoningEffort.LOW, budget, AgentRunStatus.RUNNING, created);
        projections.put(id, row); toolStatuses.put(id, new CopyOnWriteArrayList<>());
        return new InternalAgentRunRequest(new InternalAgentRunRequest.TrustedRunContext(id, row.threadId(), TRACE,
            workspace, project, user, SCOPE), budget, new ModelSelection(Provider.OPENAI, "gpt-test", ReasoningEffort.LOW),
            new SafetyContext(false, false, false, false, false, false, true),
            new InternalAgentRunRequest.AgentInput("Synthetic bounded execution", "en", "KR", null));
    }

    private HttpServer toolServer(String publicKey) throws Exception {
        var runs = mock(AgentRunRepository.class);
        when(runs.findByIdAndWorkspaceId(any(), eq(workspace))).thenAnswer(call -> Optional.ofNullable(projections.get(call.getArgument(0))));
        var projects = mock(ProjectRepository.class);
        when(projects.findByIdAndWorkspaceId(project, workspace)).thenReturn(Optional.of(new ProjectEntity(project, workspace, "Synthetic", "Input", "KRW", null, null, null)));
        var permissions = mock(WorkspacePermissionReader.class);
        when(permissions.findActiveMembership(user, workspace)).thenReturn(Optional.of(new MembershipPermissions(UUID.randomUUID(), Set.of(PermissionCode.AGENT_RUN, PermissionCode.AGENT_RESPOND, PermissionCode.AGENT_CANCEL, PermissionCode.PROJECT_READ))));
        var commands = mock(AgentRunCommandQueue.class);
        when(commands.originalPermissions(any())).thenReturn(SCOPE);
        var access = new DelegatedExecutionAccess(runs, projects, permissions, commands, mock(ByokExecutionService.class));
        var business = mock(InternalToolService.class);
        when(business.getProjectContext(eq(project), any())).thenReturn(new ProjectContext(project, workspace, "Synthetic", "Input", "KRW", null, null, null, List.of()));
        var audit = mock(ToolExecutionAuditService.class);
        when(audit.execute(anyString(), any(), any(), any(), any())).thenAnswer(call -> ((Supplier<?>)call.getArgument(4)).get());
        var api = MockMvcBuilders.standaloneSetup(new InternalToolController(business, audit)).addFilters(new DelegationTokenFilter(
            new DelegationTokenVerifier(publicKey, "long-run-test", "", "", "long-run-backend", "freelance-ops-spring-tools"), access)).build();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 18121), 0);
        server.createContext("/internal/v1", exchange -> {
            try {
                UUID id = UUID.fromString(exchange.getRequestHeaders().getFirst("X-Run-Id"));
                var result = api.perform(get(exchange.getRequestURI().getPath()).header("Authorization", exchange.getRequestHeaders().getFirst("Authorization")).header("X-Run-Id", id)).andReturn().getResponse();
                toolStatuses.get(id).add(result.getStatus());
                byte[] body = result.getContentAsByteArray();
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(result.getStatus(), body.length); exchange.getResponseBody().write(body);
            } catch (Exception error) { exchange.sendResponseHeaders(500, -1); }
            finally { exchange.close(); }
        });
        server.start(); return server;
    }

    private void startPeer(InternalAgentRunRequest request, String publicKey, Instant expires, Instant deadline, String mode, int port) throws Exception {
        Path fixture = directory.resolve(mode+"-fixture.json");
        Files.writeString(fixture, mapper.writeValueAsString(Map.of("request", request, "publicKey", publicKey,
            "expiresAt", expires.toString(), "executionDeadline", deadline.toString(), "mode", mode, "toolBaseUrl", "http://127.0.0.1:18121")));
        Path agent = Path.of("..", "agent").toAbsolutePath().normalize();
        var builder = new ProcessBuilder(System.getenv("AGENT_LIVE_TEST_PYTHON"), "tests/support/expired_jwt_http_peer.py",
            "--fixture-file", fixture.toString(), "--port", Integer.toString(port)).directory(agent.toFile())
            .redirectErrorStream(true).redirectOutput(directory.resolve(mode+"-peer.log").toFile());
        builder.environment().put("PYTHONPATH", agent.resolve("src").toString());
        Process peer = builder.start(); peers.add(peer);
        HttpClient client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
        HttpRequest probe = HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/health/readiness")).timeout(Duration.ofSeconds(1)).GET().build();
        long limit = System.nanoTime()+TimeUnit.SECONDS.toNanos(15);
        while (peer.isAlive() && System.nanoTime()<limit) {
            try { if (client.send(probe, HttpResponse.BodyHandlers.discarding()).statusCode()==200) return; }
            catch (java.io.IOException ignored) { }
            Thread.sleep(50);
        }
        throw new IllegalStateException("Bounded execution peer did not become ready");
    }

    private AgentRunView await(HttpAgentRunClient client, UUID id, String token, AgentRunStatus target, boolean partial, Duration duration) throws Exception {
        long limit = System.nanoTime()+duration.toNanos(); AgentRunView view;
        do {
            view = client.get(id, token, TRACE);
            if (view.status()==target && (!partial || view.result()!=null)) return view;
            Thread.sleep(250);
        } while (System.nanoTime()<limit);
        throw new AssertionError("Expected "+target+" but received "+view.status());
    }

    private int probeTool(UUID id, String token) throws Exception {
        return HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:18121/internal/v1/projects/"+project+"/context"))
            .header("Authorization", "Bearer "+token).header("X-Run-Id", id.toString()).GET().build(), HttpResponse.BodyHandlers.discarding()).statusCode();
    }
}
