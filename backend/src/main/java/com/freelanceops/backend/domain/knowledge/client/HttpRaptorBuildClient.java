package com.freelanceops.backend.domain.knowledge.client;

import com.freelanceops.backend.domain.knowledge.client.dto.request.RaptorBuildRequest;
import com.freelanceops.backend.domain.knowledge.client.dto.response.RaptorBuildResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class HttpRaptorBuildClient implements RaptorBuildClient {
    private final RestClient restClient;

    public HttpRaptorBuildClient(RestClient.Builder builder, @Value("${agent.base-url:http://localhost:8000}") String baseUrl) {
        this.restClient = builder.baseUrl(baseUrl).build();
    }

    @Override
    public RaptorBuildResponse build(RaptorBuildRequest request, String delegationToken, String traceparent) {
        return restClient.post().uri("/internal/v1/raptor/build").contentType(MediaType.APPLICATION_JSON)
            .headers(headers -> { headers.setBearerAuth(delegationToken); headers.set("traceparent", traceparent); })
            .body(request).retrieve().body(RaptorBuildResponse.class);
    }
}
