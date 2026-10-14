package com.freelanceops.backend.domain.agentrun.client;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.TrustedRunContext;
import com.freelanceops.backend.domain.agentrun.dto.PetProfile;
import com.freelanceops.backend.domain.agentrun.dto.request.StartAgentRunRequest.ModelSelection;
import com.freelanceops.backend.domain.agentrun.model.Provider;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
<<<<<<< HEAD

import java.net.http.HttpClient;
=======
>>>>>>> 776a510 (fix: isolate Agent HTTP transports and verify live Python contract)
import java.time.Duration;
import java.util.UUID;

@Component
public class PetGenerationClient {
    public record Input(
            TrustedRunContext context,
            ModelSelection modelSelection,
            String description,
            String slot) {}

    public record Output(
            UUID runId,
            PetProfile profile,
            Provider provider,
            String model,
            long inputTokens,
            long outputTokens) {}

    private final RestClient client;
<<<<<<< HEAD

    public PetGenerationClient(
            RestClient.Builder builder,
            @Value("${agent.base-url:http://localhost:8000}") String baseUrl) {
        var factory =
                new JdkClientHttpRequestFactory(
                        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build());
=======
    public PetGenerationClient(RestClient.Builder builder, @Value("${agent.base-url:http://localhost:8000}") String baseUrl) {
        var factory = new JdkClientHttpRequestFactory(HttpAgentRunClient.http11Client(Duration.ofSeconds(5)));
>>>>>>> 776a510 (fix: isolate Agent HTTP transports and verify live Python contract)
        factory.setReadTimeout(Duration.ofSeconds(35));
        client = builder.clone().baseUrl(baseUrl).requestFactory(factory).build();
    }

    public Output generate(Input input, String token) {
        return client.post()
                .uri("/internal/v1/pets/generate")
                .headers(headers -> headers.setBearerAuth(token))
                .body(input)
                .retrieve()
                .body(Output.class);
    }
}
