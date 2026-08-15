package com.freelanceops.backend.domain.quotation.controller;

import com.freelanceops.backend.domain.quotation.dto.request.CreateQuotationRequest;
import com.freelanceops.backend.domain.quotation.dto.request.SuggestQuotationAssumptionRequest;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationAssumptionSuggestionResponse;
import com.freelanceops.backend.domain.quotation.dto.response.QuotationResponse;
import com.freelanceops.backend.domain.quotation.service.QuotationAssumptionService;
import com.freelanceops.backend.domain.quotation.service.QuotationService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/projects/{projectId}/quotations")
public class ProjectQuotationController {
    private static final Pattern TRACEPARENT = Pattern.compile("^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$");
    private final QuotationService service;
    private final QuotationAssumptionService assumptionService;

    public ProjectQuotationController(QuotationService service, QuotationAssumptionService assumptionService) {
        this.service = service;
        this.assumptionService = assumptionService;
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

    @PostMapping("/assumption-suggestions")
    public QuotationAssumptionSuggestionResponse suggestAssumption(@PathVariable UUID workspaceId, @PathVariable UUID projectId, @Valid @RequestBody SuggestQuotationAssumptionRequest request, @RequestHeader(value = "traceparent", required = false) String traceparent, Authentication authentication) {
        return assumptionService.suggest(
            userId(authentication),
            workspaceId,
            projectId,
            request,
            trustedTraceparent(traceparent)
        );
    }

    private static UUID userId(Authentication authentication) {
        try { return UUID.fromString(authentication.getName()); }
        catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error); }
    }

    private static String trustedTraceparent(String traceparent) {
        if (traceparent != null && TRACEPARENT.matcher(traceparent).matches()) return traceparent;
        String traceId = UUID.randomUUID().toString().replace("-", "");
        String spanId = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        return "00-" + traceId + "-" + spanId + "-01";
    }
}
