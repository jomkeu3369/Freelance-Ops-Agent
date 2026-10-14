package com.freelanceops.backend.domain.agentrun.client;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import java.net.InetSocketAddress;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Actual localhost HTTP/1.1 transport; the peer is a protocol stub, with no provider I/O. */
class HttpAgentRunTransportTest {
    private static final String TRACE = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    private HttpServer server;
    private final CountDownLatch release = new CountDownLatch(1);

    @BeforeEach
    void startServer() throws Exception {
        int port = Integer.parseInt(System.getenv().getOrDefault("AGENT_TEST_HTTP_PORT", "0"));
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
    }

    @AfterEach
    void stopServer() {
        release.countDown();
        server.stop(0);
    }

    @Test
    void timesOutWhenPeerAcceptsConnectionButNeverSendsHeaders() {
        server.createContext("/internal/v1/agent-runs", exchange -> {
            try { release.await(5, TimeUnit.SECONDS); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            finally { exchange.close(); }
        });
        HttpAgentRunClient client = client(150);
        assertThatThrownBy(() -> client.events(UUID.randomUUID(), null, "synthetic-token", TRACE))
            .isInstanceOf(IllegalStateException.class)
            .hasCauseInstanceOf(HttpTimeoutException.class);
    }

    @Test
    void keepsBodyReadableAfterHeaderDeadlineAndForwardsReconnectCursor() throws Exception {
        AtomicReference<String> cursor = new AtomicReference<>();
        AtomicReference<String> trace = new AtomicReference<>();
        CountDownLatch headersSent = new CountDownLatch(1);
        server.createContext("/internal/v1/agent-runs", exchange -> {
            cursor.set(exchange.getRequestHeaders().getFirst("Last-Event-ID"));
            trace.set(exchange.getRequestHeaders().getFirst("traceparent"));
            exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
            exchange.sendResponseHeaders(200, 0);
            // Ensure headers reach the client while the body remains open.
            exchange.getResponseBody().flush();
            headersSent.countDown();
            try { release.await(5, TimeUnit.SECONDS); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            exchange.getResponseBody().write("id: 8\nevent: run.completed\ndata: {}\n\n".getBytes(StandardCharsets.UTF_8));
            exchange.close();
        });
        try (AgentEventStream stream = client(1000).events(UUID.randomUUID(), 7L, "synthetic-token", TRACE)) {
            assertThat(headersSent.await(1, TimeUnit.SECONDS)).isTrue();
            // The request timeout is for headers, not the ongoing SSE body.
            Thread.sleep(1100);
            release.countDown();
            assertThat(new String(stream.body().readAllBytes(), StandardCharsets.UTF_8)).contains("id: 8");
            assertThat(cursor.get()).isEqualTo("7");
            assertThat(trace.get()).isEqualTo(TRACE);
        }
    }

    private HttpAgentRunClient client(long responseTimeoutMs) {
        return new HttpAgentRunClient(RestClient.builder(),
            "http://127.0.0.1:" + server.getAddress().getPort(), 1000, responseTimeoutMs);
    }
}
