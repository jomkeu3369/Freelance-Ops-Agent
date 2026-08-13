package com.freelanceops.backend.domain.quotation.controller;

import com.freelanceops.backend.domain.quotation.dto.request.CreateQuotationRequest;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationResponse;
import com.freelanceops.backend.domain.quotation.service.QuotationService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/quotations/{quotationId}")
public class QuotationController {
    private final QuotationService service;

    public QuotationController(QuotationService service) {
        this.service = service;
    }

    @GetMapping
    public QuotationResponse get(@PathVariable UUID workspaceId, @PathVariable UUID quotationId, Authentication authentication) {
        return service.get(userId(authentication), workspaceId, quotationId);
    }

    @PostMapping("/revisions")
    public QuotationResponse revise(@PathVariable UUID workspaceId, @PathVariable UUID quotationId, @Valid @RequestBody CreateQuotationRequest request, Authentication authentication) {
        return service.revise(userId(authentication), workspaceId, quotationId, request);
    }

    @PostMapping("/publish")
    public QuotationResponse publish(@PathVariable UUID workspaceId, @PathVariable UUID quotationId, Authentication authentication) {
        return service.publish(userId(authentication), workspaceId, quotationId);
    }

    private static UUID userId(Authentication authentication) {
        try { return UUID.fromString(authentication.getName()); }
        catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error); }
    }
}
