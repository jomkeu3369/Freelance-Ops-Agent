package com.freelanceops.backend.domain.quotation.client;

import com.freelanceops.backend.domain.quotation.client.dto.request.InternalAssumptionSuggestionRequest;
import com.freelanceops.backend.domain.quotation.client.dto.response.InternalAssumptionSuggestionResponse;

public interface QuotationAssumptionClient {
    InternalAssumptionSuggestionResponse suggest(InternalAssumptionSuggestionRequest request, String delegationToken, String traceparent);
}
