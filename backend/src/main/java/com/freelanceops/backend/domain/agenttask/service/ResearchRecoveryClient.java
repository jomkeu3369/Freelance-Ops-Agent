package com.freelanceops.backend.domain.agenttask.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.UUID;

@Component
public class ResearchRecoveryClient {

    private final RestClient client;

    public ResearchRecoveryClient(RestClient.Builder builder, @Value("${agent.base-url:http://localhost:8000}") String baseUrl) {
        this.client = builder.baseUrl(baseUrl).build();
    }

    public void restore(UUID runId, RecoveryRequest request, String token) {
        RecoveryResponse response = client.post().uri("/internal/v1/agent-runs/{runId}/research-recovery", runId)
            .contentType(MediaType.APPLICATION_JSON).headers(headers -> headers.setBearerAuth(token))
            .body(request).retrieve().body(RecoveryResponse.class);
        if (response == null || !request.taskId().equals(response.taskId())
            || request.taskRevision() != response.taskRevision() || !request.attemptId().equals(response.attemptId())
            || !("STAGED".equals(response.status()) || "REPLAY_ONLY".equals(response.status()))
            || response.publishedEvents() < 0) {
            throw new IllegalStateException("Research recovery acknowledgement is invalid");
        }
    }

    public record RecoveryRequest(UUID taskId, int taskRevision, UUID attemptId, long authorizationRevision, long budgetRevision) {
    }

    public record RecoveryResponse(UUID taskId, int taskRevision, UUID attemptId, String status, int publishedEvents) {
    }
}
