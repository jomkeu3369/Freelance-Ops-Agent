package com.freelanceops.backend.domain.quotation.client;

import com.freelanceops.backend.domain.quotation.client.dto.request.InternalAssumptionSuggestionRequest;
import com.freelanceops.backend.domain.quotation.client.dto.response.InternalAssumptionSuggestionResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class HttpQuotationAssumptionClient implements QuotationAssumptionClient {
    private final RestClient restClient;

    public HttpQuotationAssumptionClient(RestClient.Builder builder, @Value("${agent.base-url:http://localhost:8000}") String baseUrl) {
        this.restClient = builder.baseUrl(baseUrl).build();
    }

    @Override
    public InternalAssumptionSuggestionResponse suggest(InternalAssumptionSuggestionRequest request, String delegationToken, String traceparent) {
        return restClient.post()
            .uri("/internal/v1/quotation-assumptions/suggest")
            .contentType(MediaType.APPLICATION_JSON)
            .headers(headers -> {
                headers.setBearerAuth(delegationToken);
                headers.set("traceparent", traceparent);
            })
            .body(request)
            .retrieve()
            .body(InternalAssumptionSuggestionResponse.class);
    }
}
