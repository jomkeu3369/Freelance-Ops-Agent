package com.freelanceops.backend.domain.agentrun.controller;

import com.freelanceops.backend.domain.agentrun.dto.request.ReviewRouteObservationRequest;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteAdjudicationContextResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteObservationReviewResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteReviewCanaryMetricsResponse;
import com.freelanceops.backend.domain.agentrun.dto.response.RouteReviewExportPageResponse;
import com.freelanceops.backend.domain.agentrun.service.AgentRouteReviewService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v2/workspaces/{workspaceId}/route-reviews")
public class AgentRouteReviewController {
    private final AgentRouteReviewService service;

    public AgentRouteReviewController(AgentRouteReviewService service) {
        this.service = service;
    }

    @GetMapping
    public List<RouteObservationReviewResponse> pending(
        @PathVariable UUID workspaceId,
        @RequestParam(defaultValue = "50") int limit,
        Authentication authentication
    ) {
        return service.pending(authenticatedUserId(authentication), workspaceId, limit);
    }

    @PostMapping("/claims")
    public List<RouteObservationReviewResponse> claim(
        @PathVariable UUID workspaceId,
        @RequestParam(defaultValue = "10") int limit,
        Authentication authentication
    ) {
        return service.claim(authenticatedUserId(authentication), workspaceId, limit);
    }

    @PostMapping("/adjudication-claims")
    public List<RouteObservationReviewResponse> claimAdjudication(
        @PathVariable UUID workspaceId,
        @RequestParam(defaultValue = "10") int limit,
        Authentication authentication
    ) {
        return service.claimAdjudication(authenticatedUserId(authentication), workspaceId, limit);
    }

    @GetMapping("/{observationId}/adjudication")
    public RouteAdjudicationContextResponse adjudicationContext(
        @PathVariable UUID workspaceId,
        @PathVariable UUID observationId,
        Authentication authentication
    ) {
        return service.adjudicationContext(
            authenticatedUserId(authentication), workspaceId, observationId
        );
    }

    @GetMapping("/canary-metrics")
    public RouteReviewCanaryMetricsResponse canaryMetrics(
        @PathVariable UUID workspaceId,
        @RequestParam Instant since,
        @RequestParam(defaultValue = "381") int checkpoint,
        Authentication authentication
    ) {
        return service.canaryMetrics(authenticatedUserId(authentication), workspaceId, since, checkpoint);
    }

    @GetMapping("/export")
    public RouteReviewExportPageResponse export(
        @PathVariable UUID workspaceId,
        @RequestParam Instant since,
        @RequestParam Instant until,
        @RequestParam(required = false) Instant snapshotAt,
        @RequestParam(required = false) Instant afterOccurredAt,
        @RequestParam(required = false) UUID afterId,
        @RequestParam(defaultValue = "1000") int limit,
        Authentication authentication
    ) {
        return service.exportCohort(
            authenticatedUserId(authentication), workspaceId, since, until, snapshotAt,
            afterOccurredAt, afterId, limit
        );
    }

    @PostMapping("/{observationId}")
    public RouteObservationReviewResponse review(
        @PathVariable UUID workspaceId,
        @PathVariable UUID observationId,
        @Valid @RequestBody ReviewRouteObservationRequest request,
        Authentication authentication
    ) {
        return service.review(
            authenticatedUserId(authentication), workspaceId, observationId, request
        );
    }

    private static UUID authenticatedUserId(Authentication authentication) {
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "authenticated subject must be a UUID", error);
        }
    }
}
