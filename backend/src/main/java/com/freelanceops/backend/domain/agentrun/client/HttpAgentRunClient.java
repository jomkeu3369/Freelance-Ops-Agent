package com.freelanceops.backend.domain.agentrun.client;

import com.freelanceops.backend.domain.agentrun.dto.response.AgentRunView;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.request.ResumeAgentRunRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.StartAgentRunResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.UUID;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

@Component
public class HttpAgentRunClient implements AgentRunClient {

    private final RestClient restClient;
    private final URI baseUri;
    private final HttpClient eventClient;

    public HttpAgentRunClient(RestClient.Builder builder, @Value("${agent.base-url:http://localhost:8000}") String baseUrl) {
        this.restClient = builder.baseUrl(baseUrl).build();
        this.baseUri = URI.create(baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
        this.eventClient = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
    }

    @Override
    public StartAgentRunResponse start(InternalAgentRunRequest request, String delegationToken, String traceparent) {
        return restClient.post()
            .uri("/internal/v1/agent-runs")
            .contentType(MediaType.APPLICATION_JSON)
            .headers(headers -> {
                headers.setBearerAuth(delegationToken);
                headers.set("traceparent", traceparent);
            })
            .body(request)
            .retrieve()
            .body(StartAgentRunResponse.class);
    }

    @Override
    public AgentRunView get(UUID runId, String delegationToken, String traceparent) {
        return restClient.get()
            .uri("/internal/v1/agent-runs/{runId}", runId)
            .headers(headers -> setHeaders(headers, delegationToken, traceparent))
            .retrieve()
            .body(AgentRunView.class);
    }

    @Override
    public StartAgentRunResponse resume(UUID runId, ResumeAgentRunRequest request, String delegationToken, String traceparent) {
        return restClient.post()
            .uri("/internal/v1/agent-runs/{runId}/resume", runId)
            .contentType(MediaType.APPLICATION_JSON)
            .headers(headers -> setHeaders(headers, delegationToken, traceparent))
            .body(request)
            .retrieve()
            .body(StartAgentRunResponse.class);
    }

    @Override
    public AgentRunView cancel(UUID runId, String delegationToken, String traceparent) {
        return restClient.post()
            .uri("/internal/v1/agent-runs/{runId}/cancel", runId)
            .headers(headers -> setHeaders(headers, delegationToken, traceparent))
            .retrieve()
            .body(AgentRunView.class);
    }

    @Override
    public AgentEventStream events(UUID runId, Long lastEventId, String delegationToken, String traceparent) {
        HttpRequest.Builder request = HttpRequest.newBuilder(baseUri.resolve("internal/v1/agent-runs/" + runId + "/events"))
            .GET()
            .header("Accept", MediaType.TEXT_EVENT_STREAM_VALUE)
            .header("Authorization", "Bearer " + delegationToken)
            .header("traceparent", traceparent);
        if (lastEventId != null) request.header("Last-Event-ID", lastEventId.toString());
        try {
            HttpResponse<InputStream> response = eventClient.send(request.build(), HttpResponse.BodyHandlers.ofInputStream());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                response.body().close();
                throw new IllegalStateException("agent event stream returned status " + response.statusCode());
            }
            return new AgentEventStream(response.body());
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("agent event stream was interrupted", error);
        } catch (IOException error) {
            throw new IllegalStateException("agent event stream is unavailable", error);
        }
    }

    private static void setHeaders(org.springframework.http.HttpHeaders headers, String delegationToken, String traceparent) {
        headers.setBearerAuth(delegationToken);
        headers.set("traceparent", traceparent);
    }
}


