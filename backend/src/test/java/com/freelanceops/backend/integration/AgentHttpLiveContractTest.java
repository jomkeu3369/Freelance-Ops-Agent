package com.freelanceops.backend.integration;

import com.freelanceops.backend.domain.agentrun.client.HttpAgentRunClient;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.model.AgentRunStatus;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Real Java HTTP client -> Uvicorn -> PostgreSQL. Only the executor/signing material are synthetic. */
@EnabledIfEnvironmentVariable(named = "AGENT_LIVE_TEST_FIXTURE", matches = ".+")
class AgentHttpLiveContractTest {
    private static final String TRACE = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    private Process peer;

    @BeforeEach
    void launchLocalPeerWhenRequested() throws Exception {
        String python = System.getenv("AGENT_LIVE_TEST_PYTHON");
        if (python == null || python.isBlank()) return;
        var agent = Path.of("..", "agent").toAbsolutePath().normalize();
        var fixture = Path.of(System.getenv("AGENT_LIVE_TEST_FIXTURE"));
        String port = Integer.toString(java.net.URI.create(System.getenv("AGENT_LIVE_TEST_BASE_URL")).getPort());
        var process = new ProcessBuilder(python, "tests/support/live_http_peer.py", "--port", port,
            "--fixture-output", fixture.toString()).directory(agent.toFile())
            .redirectErrorStream(true).redirectOutput(fixture.resolveSibling("live-peer.log").toFile());
        process.environment().put("PYTHONPATH", agent.resolve("src").toString());
        peer = process.start();
        var probe = java.net.http.HttpClient.newBuilder().version(java.net.http.HttpClient.Version.HTTP_1_1).build();
        var request = java.net.http.HttpRequest.newBuilder(
            java.net.URI.create(System.getenv("AGENT_LIVE_TEST_BASE_URL") + "/health/readiness"))
            .timeout(java.time.Duration.ofSeconds(1)).GET().build();
        long deadline = System.nanoTime() + java.time.Duration.ofSeconds(15).toNanos();
        while (peer.isAlive() && System.nanoTime() < deadline) {
            try {
                if (probe.send(request, java.net.http.HttpResponse.BodyHandlers.discarding()).statusCode() == 200) return;
            } catch (java.io.IOException ignored) { }
            Thread.sleep(50);
        }
        throw new IllegalStateException("Local Agent peer did not become ready; inspect the test peer log");
    }

    @AfterEach
    void stopOnlyThisTestsPeer() throws Exception {
        if (peer != null) {
            peer.destroy();
            if (!peer.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)) peer.destroyForcibly();
        }
    }

    @Test
    void authenticatedLifecycleAndReconnectTraverseTheRealAgentHttpContract() throws Exception {
        var mapper = JsonMapper.builder().findAndAddModules().build();
        var fixture = mapper.readTree(Files.readString(Path.of(System.getenv("AGENT_LIVE_TEST_FIXTURE"))));
        var request = mapper.treeToValue(fixture.get("request"), InternalAgentRunRequest.class);
        String token = fixture.get("token").asString();
        var client = new HttpAgentRunClient(RestClient.builder(), System.getenv("AGENT_LIVE_TEST_BASE_URL"));
        UUID runId = request.context().runId();

        assertThat(client.start(request, token, TRACE).runId()).isEqualTo(runId);
        var waiting = awaitStatus(client, runId, token, AgentRunStatus.WAITING_FOR_USER);
        assertThat(client.start(request, token, TRACE).status()).isEqualTo(AgentRunStatus.WAITING_FOR_USER);
        try (var stream = client.events(runId, 0L, token, TRACE)) {
            String events = new String(stream.body().readAllBytes(), StandardCharsets.UTF_8);
            assertThat(events).contains("id: 1", "run.accepted", "clarification.requested");
            assertThat(events.split("event: run.started", -1)).hasSize(2);
        }
        // No duplicate start events are replayed after the last durable cursor.
        try (var stream = client.events(runId, 3L, token, TRACE)) {
            assertThat(stream.body().readAllBytes()).isEmpty();
        }
        var resume = new ResumeAgentRunRequest(waiting.interruption().interruptionId(), "live-resume-1",
            List.of(new ResumeAgentRunRequest.ResumeAnswer(0, "Synthetic localhost answer")));
        assertThat(client.resume(runId, resume, token, TRACE).runId()).isEqualTo(runId);
        var completed = awaitStatus(client, runId, token, AgentRunStatus.COMPLETED);
        assertThat(completed.result().projectSummary()).isEqualTo("resumed");
        assertThatThrownBy(() -> client.resume(runId, resume, token, TRACE))
            .isInstanceOfSatisfying(RestClientResponseException.class,
                error -> assertThat(error.getStatusCode().value()).isEqualTo(409));
        try (var stream = client.events(runId, 3L, token, TRACE)) {
            String events = new String(stream.body().readAllBytes(), StandardCharsets.UTF_8);
            assertThat(events).contains("id: 4", "clarification.responded", "run.completed").doesNotContain("id: 1");
        }
        assertThatThrownBy(() -> client.get(UUID.randomUUID(), token, TRACE))
            .isInstanceOfSatisfying(RestClientResponseException.class,
                error -> assertThat(error.getStatusCode().value()).isEqualTo(403));
        assertThatThrownBy(() -> client.get(runId, "invalid-test-token", TRACE))
            .isInstanceOfSatisfying(RestClientResponseException.class,
                error -> assertThat(error.getStatusCode().value()).isEqualTo(401));
        assertThat(client.get(runId, token, TRACE).status()).isEqualTo(AgentRunStatus.COMPLETED);
    }

    private AgentRunView awaitStatus(HttpAgentRunClient client, UUID runId, String token, AgentRunStatus expected)
            throws InterruptedException {
        long deadline = System.nanoTime() + java.time.Duration.ofSeconds(5).toNanos();
        AgentRunView view;
        do {
            view = client.get(runId, token, TRACE);
            if (view.status() == expected) return view;
            Thread.sleep(25);
        } while (System.nanoTime() < deadline);
        assertThat(view.status()).isEqualTo(expected);
        return view;
    }
}
