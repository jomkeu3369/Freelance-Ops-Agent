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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/projects/{projectId}/quotations")
public class ProjectQuotationController {
    private final QuotationService service;

    public ProjectQuotationController(QuotationService service) {
        this.service = service;
    }

    @GetMapping
    public List<QuotationResponse> list(@PathVariable UUID workspaceId, @PathVariable UUID projectId, Authentication authentication) {
        return service.list(userId(authentication), workspaceId, projectId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public QuotationResponse create(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @Valid @RequestBody CreateQuotationRequest request, Authentication authentication) {
        return service.create(userId(authentication), workspaceId, projectId, request);
    }

    private static UUID userId(Authentication authentication) {
        try { return UUID.fromString(authentication.getName()); }
        catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error); }
    }
}
