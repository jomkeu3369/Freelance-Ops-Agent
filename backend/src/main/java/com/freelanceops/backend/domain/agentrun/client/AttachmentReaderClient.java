package com.freelanceops.backend.domain.agentrun.client;

import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.TrustedRunContext;
import com.freelanceops.backend.domain.agentrun.dto.AttachmentText;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import java.net.http.HttpClient;
import java.time.Duration;

@Component
public class AttachmentReaderClient {
    public record FileInput(String name, String mediaType, String base64, String encoding, String delimiter,
                            String ocrLanguage, String ocrLayout) { }
    public record Input(TrustedRunContext context, FileInput file) { }
    private final RestClient client;
    public AttachmentReaderClient(RestClient.Builder builder, @Value("${agent.base-url:http://localhost:8000}") String baseUrl) {
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build());
        factory.setReadTimeout(Duration.ofSeconds(20));
        client = builder.baseUrl(baseUrl).requestFactory(factory).build();
    }
    public AttachmentText read(Input input, String token) {
        return client.post().uri("/internal/v1/attachments/extract")
            .headers(headers -> headers.setBearerAuth(token)).body(input).retrieve().body(AttachmentText.class);
    }
}
