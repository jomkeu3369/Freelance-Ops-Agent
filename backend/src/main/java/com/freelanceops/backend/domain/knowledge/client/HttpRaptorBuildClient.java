package com.freelanceops.backend.domain.knowledge.client;

import com.freelanceops.backend.domain.knowledge.client.dto.request.RaptorBuildRequest;
import com.freelanceops.backend.domain.knowledge.client.dto.response.RaptorBuildResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import java.net.http.HttpClient;
import java.time.Duration;

@Component
public class HttpRaptorBuildClient implements RaptorBuildClient {
    private final RestClient restClient;

    public HttpRaptorBuildClient(RestClient.Builder builder, @Value("${agent.base-url:http://localhost:8000}") String baseUrl, @Value("${app.http.connect-timeout-ms:2000}") long connectTimeoutMs, @Value("${agent.raptor-build-read-timeout-ms:310000}") long readTimeoutMs) {
        if (connectTimeoutMs <= 0 || readTimeoutMs <= 0) throw new IllegalStateException("RAPTOR HTTP client timeouts must be positive");
        HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofMillis(connectTimeoutMs)).version(HttpClient.Version.HTTP_1_1).followRedirects(HttpClient.Redirect.NEVER).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(client);
        factory.setReadTimeout(Duration.ofMillis(readTimeoutMs));
        this.restClient = builder.clone().requestFactory(factory).baseUrl(baseUrl).build();
    }

    @Override
    public RaptorBuildResponse build(RaptorBuildRequest request, String delegationToken, String traceparent) {
        return restClient.post().uri("/internal/v1/raptor/build").contentType(MediaType.APPLICATION_JSON)
            .headers(headers -> { headers.setBearerAuth(delegationToken); headers.set("traceparent", traceparent); })
            .body(request).retrieve().body(RaptorBuildResponse.class);
    }
}
