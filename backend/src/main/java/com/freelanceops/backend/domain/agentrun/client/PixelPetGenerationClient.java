package com.freelanceops.backend.domain.agentrun.client;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.PlatformBudget;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.TrustedRunContext;
import com.freelanceops.backend.domain.agentrun.client.dto.response.PixelPetGenerationResult;
import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.RunBudget;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Duration;

@Component
public class PixelPetGenerationClient {
    public record Input(
            TrustedRunContext context,
            ModelSelection modelSelection,
            String description,
            PetProfile previous,
            PlatformBudget platformBudget,
            RunBudget budget) {}

    private final RestClient client;

    public PixelPetGenerationClient(
            RestClient.Builder builder,
            @Value("${agent.base-url:http://localhost:8000}") String baseUrl) {
        var factory =
                new JdkClientHttpRequestFactory(
                        HttpAgentRunClient.http11Client(Duration.ofSeconds(5)));
        factory.setReadTimeout(Duration.ofSeconds(65));
        client = builder.clone().baseUrl(baseUrl).requestFactory(factory).build();
    }

    public PixelPetGenerationResult generate(Input input, String token) {
        return client.post()
                .uri("/internal/v1/pets/generate-pixel")
                .headers(headers -> headers.setBearerAuth(token))
                .body(input)
                .retrieve()
                .body(PixelPetGenerationResult.class);
    }
}
