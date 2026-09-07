package com.freelanceops.backend.global.health;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class AgentServiceHealthIndicator implements HealthIndicator {

    private final RestClient restClient;

    public AgentServiceHealthIndicator(RestClient.Builder builder, @Value("${agent.base-url}") String baseUrl) {
        this.restClient = builder.baseUrl(baseUrl).build();
    }

    @Override
    public Health health() {
        try {
            AgentHealthResponse response = restClient.get()
                .uri("/health/readiness")
                .retrieve()
                .body(AgentHealthResponse.class);
            if (response != null && "UP".equals(response.status())) {
                return Health.up()
                    .withDetail("service", response.service())
                    .withDetail("version", response.version())
                    .build();
            }
            return Health.down().withDetail("reason", "Agent returned an invalid health response").build();
        } catch (RuntimeException exception) {
            return Health.down(exception).build();
        }
    }

    private record AgentHealthResponse(String status, String service, String version) {
    }
}



